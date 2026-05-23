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

// ── Dashboard read endpoints ─────────────────────────────────

function mirrorKenyanToday(): string {
  return new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function mirrorAddDays(dateStr: string, n: number): string {
  const d = new Date(dateStr + "T12:00:00Z");
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

// Return 0 safely for BigInt or undefined values from aggregate queries
function toNum(v: unknown): number {
  if (v == null) return 0;
  if (typeof v === "bigint") return Number(v);
  return Number(v);
}

async function tableExists(name: string): Promise<boolean> {
  const r = await prisma.$queryRawUnsafe<{ tbl: string | null }[]>(
    `SELECT to_regclass($1) AS tbl`, name
  );
  return !!r[0]?.tbl;
}

function parseData(row: { data: unknown }): Record<string, unknown> {
  if (!row?.data) return {};
  if (typeof row.data === "string") {
    try { return JSON.parse(row.data); } catch { return {}; }
  }
  return row.data as Record<string, unknown>;
}

// GET /sync/mirror/sales?date=YYYY-MM-DD&page=N&staff=&method=&minAmount=&search=&posted=
// Returns POS transactions for a date from mirror tables (much richer than web SalesOrders).
router.get("/mirror/sales", requireAuth, async (req, res) => {
  const { date, staff, method, minAmount, search, posted: postedFilter, page = "1" } = req.query as Record<string, string>;
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date))
    return res.status(400).json({ error: "date required (YYYY-MM-DD)" });

  const pageNum  = Math.max(1, parseInt(page) || 1);
  const pageSize = 50;

  try {
    if (!(await tableExists("mirror_pos_header")))
      return res.json({ rows: [], total: 0, page: 1, pages: 0 });

    // Load all data for the date in parallel
    const [rawHeaders, rawDetails, rawPpd] = await Promise.all([
      prisma.$queryRawUnsafe<{ data: unknown }[]>(
        `SELECT data FROM mirror_pos_header WHERE row_date = $1`, date
      ),
      tableExists("mirror_pos_details").then(exists => exists
        ? prisma.$queryRawUnsafe<{ data: unknown }[]>(
            `SELECT data FROM mirror_pos_details WHERE row_date = $1`, date
          )
        : []
      ),
      tableExists("mirror_pos_payment_details").then(exists => exists
        ? prisma.$queryRawUnsafe<{ data: unknown }[]>(
            `SELECT data FROM mirror_pos_payment_details
             WHERE row_date = $1 AND (data->>'pamount')::numeric < 500000`, date
          )
        : []
      ),
    ]);

    // Build lookup maps
    const detailsByRct: Record<string, any[]> = {};
    for (const r of rawDetails as { data: unknown }[]) {
      const d = parseData(r);
      const rno = String(d.receiptno ?? "");
      if (!detailsByRct[rno]) detailsByRct[rno] = [];
      detailsByRct[rno].push(d);
    }

    const methodsByRct: Record<string, string[]> = {};
    for (const r of rawPpd as { data: unknown }[]) {
      const p = parseData(r);
      const rno = String(p.receiptno ?? "");
      if (!methodsByRct[rno]) methodsByRct[rno] = [];
      const mn = String(p.payname ?? "");
      if (mn && !methodsByRct[rno].includes(mn)) methodsByRct[rno].push(mn);
    }

    // Apply filters in JS
    let rows: any[] = rawHeaders.map(r => parseData(r as { data: unknown }));

    if (postedFilter === "1") rows = rows.filter(h => Number(h.posted) === 1);
    if (postedFilter === "0") rows = rows.filter(h => Number(h.posted) !== 1);
    if (staff)     rows = rows.filter(h => String(h.staff ?? "").toUpperCase().includes(staff.toUpperCase()));
    if (minAmount) rows = rows.filter(h => Number(h.amount) >= Number(minAmount));
    if (method)    rows = rows.filter(h => (methodsByRct[String(h.receiptno)] ?? []).some(m => m.toLowerCase().includes(method.toLowerCase())));
    if (search)    rows = rows.filter(h =>
      String(h.receiptno ?? "").toLowerCase().includes(search.toLowerCase()) ||
      (detailsByRct[String(h.receiptno)] ?? []).some(d =>
        String(d.description ?? d.descr ?? "").toLowerCase().includes(search.toLowerCase())
      )
    );

    rows.sort((a, b) => new Date(String(b.trandate ?? 0)).getTime() - new Date(String(a.trandate ?? 0)).getTime());

    const total  = rows.length;
    const sliced = rows.slice((pageNum - 1) * pageSize, pageNum * pageSize);

    return res.json({
      total,
      page:  pageNum,
      pages: Math.ceil(total / pageSize) || 0,
      rows: sliced.map(h => ({
        receiptno: h.receiptno,
        trandate:  h.trandate,
        staff:     h.staff ? String(h.staff).toUpperCase() : "—",
        amount:    Number(h.amount ?? 0),
        posted:    Number(h.posted ?? 0),
        is_return: Number(h.is_return ?? 0),
        methods:   methodsByRct[String(h.receiptno)] ?? [],
        items: (detailsByRct[String(h.receiptno)] ?? []).map(d => ({
          code:        d.code,
          description: d.description ?? d.descr,
          qty:         Number(d.qty ?? 0),
          price:       Number(d.price ?? 0),
          total:       Number(d.total ?? 0),
        })),
      })),
    });
  } catch (e: any) {
    console.error("[mirror/sales]", e.message);
    return res.status(500).json({ error: e.message });
  }
});

// GET /sync/mirror/analytics?from=YYYY-MM-DD&to=YYYY-MM-DD
// Daily aggregates + top products + payment split for the Analytics page.
router.get("/mirror/analytics", requireAuth, async (req, res) => {
  const today = mirrorKenyanToday();
  const from  = String(req.query.from || mirrorAddDays(today, -30));
  const to    = String(req.query.to   || today);

  try {
    if (!(await tableExists("mirror_pos_header")))
      return res.json({ salesByDate: [], topProducts: [], paymentSplit: [] });

    // Daily sales totals
    const salesRows = await prisma.$queryRawUnsafe<any[]>(`
      SELECT
        row_date AS date,
        COUNT(*)::int                     FILTER (WHERE (data->>'posted')::int = 1
          AND (data->>'is_return') IS DISTINCT FROM '1') AS transactions,
        SUM((data->>'amount')::numeric)   FILTER (WHERE (data->>'posted')::int = 1
          AND (data->>'is_return') IS DISTINCT FROM '1') AS total_sales
      FROM mirror_pos_header
      WHERE row_date >= $1 AND row_date <= $2
      GROUP BY row_date
      ORDER BY row_date
    `, from, to);

    // Daily purchases
    const purchaseRows = (await tableExists("mirror_grn"))
      ? await prisma.$queryRawUnsafe<any[]>(`
          SELECT
            row_date AS date,
            SUM((data->>'gtotal')::numeric) FILTER (WHERE (data->>'posted')::int = 1) AS purchases
          FROM mirror_grn
          WHERE row_date >= $1 AND row_date <= $2
          GROUP BY row_date
          ORDER BY row_date
        `, from, to).catch(() => [] as any[])
      : [];

    const purchaseMap: Record<string, number> = {};
    for (const r of purchaseRows) purchaseMap[String(r.date)] = toNum(r.purchases);

    const salesByDate = salesRows.map(r => ({
      date:         String(r.date),
      transactions: toNum(r.transactions),
      totalSales:   toNum(r.total_sales),
      purchases:    purchaseMap[String(r.date)] ?? 0,
    }));

    // Top products (from mirror_pos_details, excludes returns via qty > 0)
    const topProducts = (await tableExists("mirror_pos_details"))
      ? await prisma.$queryRawUnsafe<any[]>(`
          SELECT
            data->>'code' AS code,
            MAX(data->>'description') AS name,
            SUM((data->>'qty')::numeric)::float8   AS qty_sold,
            SUM((data->>'total')::numeric)::float8 AS revenue
          FROM mirror_pos_details
          WHERE row_date >= $1 AND row_date <= $2
            AND (data->>'qty')::numeric > 0
          GROUP BY data->>'code'
          ORDER BY revenue DESC
          LIMIT 20
        `, from, to).then(r => r.map(p => ({
            code:    String(p.code ?? ""),
            name:    String(p.name ?? p.code ?? ""),
            qtySold: toNum(p.qty_sold),
            revenue: toNum(p.revenue),
          }))).catch(() => [] as any[])
      : [];

    // Payment split (with corrupted-row filter)
    const paymentSplit = (await tableExists("mirror_pos_payment_details"))
      ? await prisma.$queryRawUnsafe<any[]>(`
          SELECT
            data->>'payname' AS method,
            COUNT(*)::int                          AS transactions,
            SUM((data->>'pamount')::numeric)::float8 AS total
          FROM mirror_pos_payment_details
          WHERE row_date >= $1 AND row_date <= $2
            AND (data->>'pamount')::numeric > 0
            AND (data->>'pamount')::numeric < 500000
          GROUP BY data->>'payname'
          ORDER BY total DESC
        `, from, to).then(r => r.map(p => ({
            method:       String(p.method ?? "Unknown"),
            transactions: toNum(p.transactions),
            total:        toNum(p.total),
          }))).catch(() => [] as any[])
      : [];

    return res.json({ salesByDate, topProducts, paymentSplit });
  } catch (e: any) {
    console.error("[mirror/analytics]", e.message);
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
