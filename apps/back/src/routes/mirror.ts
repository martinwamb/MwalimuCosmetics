import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { requireAuth } from "../lib/authz.js";

export const router = Router();

const SYNC_SECRET = process.env.SYNC_SECRET ?? "mwalimu-sync-secret";

function checkSecret(req: any, res: any): boolean {
  if (req.headers["x-sync-secret"] !== SYNC_SECRET) {
    res.status(401).json({ error: "Unauthorized" });
    return false;
  }
  return true;
}

// Tables whose rows have a stable natural key → upsert on conflict
const KEYED: Record<string, string> = {
  pos_header: "receiptno",
  grn:        "no",
};

// Tables with no stable per-row key → delete date's rows then bulk insert
const DATE_ONLY = new Set(["pos_details", "pos_payment_details", "stran", "grn_d"]);

const ALL_TABLES = new Set([...Object.keys(KEYED), ...DATE_ONLY]);

// ── Table initialisation ─────────────────────────────────────

async function ensureMeta() {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS mirror_meta (
      key        TEXT PRIMARY KEY,
      value      TEXT,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )`);
}

async function ensureTable(table: string) {
  if (table === "sitems") {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS mirror_sitems (
        code      TEXT PRIMARY KEY,
        data      JSONB NOT NULL,
        synced_at TIMESTAMPTZ DEFAULT NOW()
      )`);
    return;
  }
  if (KEYED[table]) {
    const pk = KEYED[table];
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS mirror_${table} (
        ${pk}     TEXT PRIMARY KEY,
        row_date  TEXT NOT NULL,
        data      JSONB NOT NULL,
        synced_at TIMESTAMPTZ DEFAULT NOW()
      )`);
  } else {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS mirror_${table} (
        id        BIGSERIAL PRIMARY KEY,
        row_date  TEXT NOT NULL,
        data      JSONB NOT NULL,
        synced_at TIMESTAMPTZ DEFAULT NOW()
      )`);
    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS idx_mirror_${table}_date
        ON mirror_${table}(row_date)`);
  }
}

// ── Status / watermark ───────────────────────────────────────

// GET /sync/mirror/status  →  { lastDate: "2026-05-12" | null }
router.get("/mirror/status", async (req, res) => {
  if (!checkSecret(req, res)) return;
  try {
    await ensureMeta();
    const rows = await prisma.$queryRawUnsafe<{ value: string }[]>(
      `SELECT value FROM mirror_meta WHERE key = 'last_mirrored_date'`
    );
    return res.json({ lastDate: rows[0]?.value ?? null });
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
});

// POST /sync/mirror/status  body: { lastDate }
// Called by the bridge after each successful batch to advance the watermark.
router.post("/mirror/status", async (req, res) => {
  if (!checkSecret(req, res)) return;
  const { lastDate } = req.body as { lastDate: string };
  if (!lastDate) return res.status(400).json({ error: "lastDate required" });
  try {
    await ensureMeta();
    await prisma.$executeRawUnsafe(
      `INSERT INTO mirror_meta(key, value, updated_at)
       VALUES('last_mirrored_date', $1, NOW())
       ON CONFLICT(key) DO UPDATE
         SET value = EXCLUDED.value, updated_at = NOW()`,
      lastDate
    );
    return res.json({ ok: true });
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
});

// ── Pause / resume / progress ────────────────────────────────

// GET /sync/mirror/paused — bridge polls this between dates to check if paused
router.get("/mirror/paused", async (req, res) => {
  if (!checkSecret(req, res)) return;
  try {
    await ensureMeta();
    const rows = await prisma.$queryRawUnsafe<{ value: string }[]>(
      `SELECT value FROM mirror_meta WHERE key = 'mirror_paused'`
    );
    return res.json({ paused: rows[0]?.value === "true" });
  } catch {
    return res.json({ paused: false });
  }
});

// POST /sync/mirror/pause — dashboard pauses the running batch
router.post("/mirror/pause", requireAuth, async (req, res) => {
  try {
    await ensureMeta();
    await prisma.$executeRawUnsafe(
      `INSERT INTO mirror_meta(key, value, updated_at) VALUES('mirror_paused','true',NOW())
       ON CONFLICT(key) DO UPDATE SET value='true', updated_at=NOW()`
    );
    return res.json({ ok: true });
  } catch (e: any) { return res.status(500).json({ error: e.message }); }
});

// POST /sync/mirror/resume — clears the pause flag (next batch will check this)
router.post("/mirror/resume", requireAuth, async (req, res) => {
  try {
    await ensureMeta();
    await prisma.$executeRawUnsafe(
      `INSERT INTO mirror_meta(key, value, updated_at) VALUES('mirror_paused','false',NOW())
       ON CONFLICT(key) DO UPDATE SET value='false', updated_at=NOW()`
    );
    return res.json({ ok: true });
  } catch (e: any) { return res.status(500).json({ error: e.message }); }
});

// GET /sync/mirror/progress — dashboard reads mirror status and pause state
router.get("/mirror/progress", requireAuth, async (req, res) => {
  try {
    await ensureMeta();
    const rows = await prisma.$queryRawUnsafe<{ key: string; value: string }[]>(
      `SELECT key, value FROM mirror_meta WHERE key IN ('last_mirrored_date','mirror_paused')`
    );
    const meta: Record<string, string> = {};
    for (const r of rows) meta[r.key] = r.value;
    return res.json({
      lastDate: meta["last_mirrored_date"] ?? null,
      paused:   meta["mirror_paused"] === "true",
    });
  } catch (e: any) { return res.status(500).json({ error: e.message }); }
});

// ── Row upload ───────────────────────────────────────────────

// POST /sync/mirror/rows  body: { table, date, rows[] }
// Rows arrive as plain objects; we store each as a JSONB blob.
// Keyed tables: upsert by natural key (idempotent for retries).
// Date-only tables: delete the date's rows then bulk insert.
router.post("/mirror/rows", async (req, res) => {
  if (!checkSecret(req, res)) return;
  const { table, date, rows } = req.body as {
    table: string; date: string; rows: Record<string, unknown>[];
  };

  if (!ALL_TABLES.has(table))
    return res.status(400).json({ error: "table not allowed" });
  if (!date || !Array.isArray(rows))
    return res.status(400).json({ error: "date and rows required" });

  try {
    await ensureTable(table);

    if (rows.length === 0) {
      // No data for this date — clear stale rows so the date is "clean"
      if (DATE_ONLY.has(table))
        await prisma.$executeRawUnsafe(
          `DELETE FROM mirror_${table} WHERE row_date = $1`, date
        );
      return res.json({ ok: true, rows: 0 });
    }

    // Serialise entire batch as one JSONB array — PostgreSQL unpacks with
    // jsonb_array_elements, avoiding per-row round-trips.
    const blob = JSON.stringify(rows);

    if (KEYED[table]) {
      const pk = KEYED[table];
      // Extract the natural key from each element in the JSONB array and upsert
      await prisma.$executeRawUnsafe(
        `INSERT INTO mirror_${table} (${pk}, row_date, data, synced_at)
         SELECT elem->>'${pk}', $1, elem, NOW()
         FROM   jsonb_array_elements($2::jsonb) AS elem
         WHERE  elem->>'${pk}' IS NOT NULL
         ON CONFLICT (${pk}) DO UPDATE
           SET data      = EXCLUDED.data,
               row_date  = EXCLUDED.row_date,
               synced_at = NOW()`,
        date, blob
      );
    } else {
      // Delete this date's rows, then bulk-insert fresh data
      await prisma.$executeRawUnsafe(
        `DELETE FROM mirror_${table} WHERE row_date = $1`, date
      );
      await prisma.$executeRawUnsafe(
        `INSERT INTO mirror_${table} (row_date, data, synced_at)
         SELECT $1, value, NOW()
         FROM   jsonb_array_elements($2::jsonb)`,
        date, blob
      );
    }

    return res.json({ ok: true, rows: rows.length });
  } catch (e: any) {
    console.error(`[mirror/rows] ${table} ${date}:`, e.message);
    return res.status(500).json({ error: e.message });
  }
});

// POST /sync/mirror/reference  body: { table, rows[] }
// Full-replace reference tables that have no date dimension (e.g. sitems).
router.post("/mirror/reference", async (req, res) => {
  if (!checkSecret(req, res)) return;
  const { table, rows } = req.body as {
    table: string; rows: Record<string, unknown>[];
  };

  if (table !== "sitems")
    return res.status(400).json({ error: "only sitems is supported" });
  if (!Array.isArray(rows))
    return res.status(400).json({ error: "rows required" });

  try {
    await ensureTable("sitems");
    if (rows.length === 0) return res.json({ ok: true, rows: 0 });

    const blob = JSON.stringify(rows);
    // CODE field may be uppercase or lowercase depending on MySQL version
    await prisma.$executeRawUnsafe(
      `INSERT INTO mirror_sitems (code, data, synced_at)
       SELECT COALESCE(elem->>'CODE', elem->>'code'), elem, NOW()
       FROM   jsonb_array_elements($1::jsonb) AS elem
       WHERE  COALESCE(elem->>'CODE', elem->>'code') IS NOT NULL
       ON CONFLICT (code) DO UPDATE
         SET data = EXCLUDED.data, synced_at = NOW()`,
      blob
    );
    return res.json({ ok: true, rows: rows.length });
  } catch (e: any) {
    console.error("[mirror/reference] sitems:", e.message);
    return res.status(500).json({ error: e.message });
  }
});
