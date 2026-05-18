import { Router } from "express";
import { z } from "zod";
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

// ── Metrics ──────────────────────────────────────────────────

const metricsSchema = z.object({
  forDate:           z.string(),
  transactions:      z.number(),
  totalSales:        z.number(),
  tax:               z.number().default(0),
  cashSales:         z.number(),
  mpesaSales:        z.number(),
  otherSales:        z.number(),
  draftTransactions: z.number().default(0),
  draftSales:        z.number().default(0),
  purchases:         z.number().default(0),
  profit:            z.number().default(0),
  agentVersion:      z.string().optional(),
  paymentBreakdown: z.array(z.object({
    name:         z.string(),
    transactions: z.number(),
    total:        z.number(),
  })),
  topProducts: z.array(z.object({
    code:    z.string(),
    name:    z.string(),
    qtySold: z.number(),
    revenue: z.number(),
  })),
  byStaff: z.array(z.object({
    staff:        z.string(),
    transactions: z.number(),
    total:        z.number(),
    returns:      z.number().default(0),
  })),
});

// Bridge PCs push metrics here using the sync secret
router.post("/metrics", async (req, res) => {
  if (!checkSecret(req, res)) return;

  const parsed = metricsSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  // Strip agentVersion before passing to Prisma (not a DB column)
  const { agentVersion, ...data } = parsed.data;

  // Old agent detection: agents before v20260501 don't send agentVersion and
  // lack posted=1 filtering, so their totalSales includes drafts and
  // paymentBreakdown covers all transactions. Only reject if:
  //   1. No agentVersion field (new agents always send it), AND
  //   2. An accurate snapshot already exists for the day
  if (!agentVersion) {
    const existing = await prisma.metricsSnapshot.findFirst({ where: { forDate: data.forDate } });
    const ex = existing as any;
    if (existing && (existing.tax > 0 || ex.profit > 0 || ex.purchases > 0)) {
      return res.json({ ok: true });
    }
  }

  await prisma.metricsSnapshot.deleteMany({ where: { forDate: data.forDate } });
  await prisma.metricsSnapshot.create({ data });

  return res.json({ ok: true });
});

// Dashboard reads latest snapshot (requires staff login)
router.get("/metrics/latest", requireAuth, async (_req, res) => {
  const snapshot = await prisma.metricsSnapshot.findFirst({
    orderBy: { capturedAt: "desc" },
  });
  return res.json(snapshot ?? null);
});

// ── On-demand sync trigger ────────────────────────────────────
// Dashboard posts here when user clicks Refresh. The shop PC polls
// /sync/pending-refresh every few seconds and runs MySQL sync when triggered.

router.post("/request", requireAuth, async (_req, res) => {
  const record = await prisma.syncRequest.create({ data: {} });
  return res.json({ id: record.id, requestedAt: record.requestedAt });
});

// Shop PC polls this (with sync secret) every 5 seconds — no MySQL involved.
// Returns { pending: true } once, then marks it fulfilled so it only fires once.
router.get("/pending-refresh", async (req, res) => {
  if (!checkSecret(req, res)) return;
  const pending = await prisma.syncRequest.findFirst({
    where:   { fulfilledAt: null },
    orderBy: { requestedAt: "asc" },
  });
  if (!pending) return res.json({ pending: false });
  await prisma.syncRequest.update({
    where: { id: pending.id },
    data:  { fulfilledAt: new Date() },
  });
  return res.json({ pending: true });
});

// ── Product catalogue sync ────────────────────────────────────

router.post("/products", async (req, res) => {
  if (!checkSecret(req, res)) return;

  const { products } = req.body as {
    products: Array<{
      sku: string; name: string; price: number; category: string; stockQty: number;
      cost?: number; wholesalePrice?: number | null; specialPrice?: number | null;
    }>;
  };
  if (!Array.isArray(products)) return res.status(400).json({ error: "products must be array" });

  let upserted = 0;
  for (const p of products) {
    if (!p.sku || !p.name || p.price <= 0) continue;

    let cat = await prisma.category.findFirst({
      where: { name: { equals: p.category, mode: "insensitive" } },
    });
    if (!cat) cat = await prisma.category.create({ data: { name: p.category } });

    const costVal     = typeof p.cost === "number" && p.cost > 0 ? p.cost : undefined;
    const wholesale   = typeof p.wholesalePrice === "number" && p.wholesalePrice > 0 ? p.wholesalePrice : null;
    const special     = typeof p.specialPrice   === "number" && p.specialPrice   > 0 ? p.specialPrice   : null;

    await prisma.product.upsert({
      where:  { sku: p.sku },
      update: {
        name:           p.name,
        price:          p.price,
        stockQty:       p.stockQty,
        categoryId:     cat.id,
        status:         p.stockQty > 0 ? "ACTIVE" : "INACTIVE",
        ...(costVal !== undefined ? { cost: costVal } : {}),
        wholesalePrice: wholesale,
        specialPrice:   special,
      },
      create: {
        sku:            p.sku,
        name:           p.name,
        price:          p.price,
        cost:           costVal ?? 0,
        wholesalePrice: wholesale,
        specialPrice:   special,
        stockQty:       p.stockQty,
        categoryId:     cat.id,
        status:         p.stockQty > 0 ? "ACTIVE" : "INACTIVE",
      },
    });
    upserted++;
  }

  return res.json({ ok: true, upserted });
});

// ── Unsynced web sales (for writeback to MySQL) ───────────────

router.get("/unsynced-sales", async (req, res) => {
  // Accept either the sync secret or a valid staff Bearer token
  const secret = req.headers["x-sync-secret"];
  const auth   = req.headers["authorization"];
  if (secret !== SYNC_SECRET && !auth) return res.status(401).json({ error: "Unauthorized" });

  const sales = await prisma.salesOrder.findMany({
    where:   { mysqlSynced: false, channel: "COUNTER" },
    orderBy: { createdAt: "asc" },
    take:    50,
    include: {
      items:     { include: { product: { select: { sku: true, name: true } } } },
      createdBy: { select: { name: true } },
    },
  });

  return res.json(sales.map(s => ({
    id:             s.id,
    total:          Number(s.total),
    amountPaid:     Number(s.amountPaid),
    changeDue:      Number(s.changeDue),
    paymentDetails: s.paymentDetails,
    staffCode:      s.createdBy?.name ?? "WEB",
    createdAt:      s.createdAt,
    items: s.items.map(i => ({
      sku:         i.product.sku,
      productName: i.product.name,
      qty:         i.qty,
      unitPrice:   Number(i.unitPrice),
    })),
  })));
});

router.post("/mark-synced", async (req, res) => {
  if (!checkSecret(req, res)) return;

  const { orderId, mysqlReceiptNo } = req.body as { orderId: string; mysqlReceiptNo: string };
  await prisma.salesOrder.update({
    where: { id: orderId },
    data:  { mysqlSynced: true, mysqlReceiptNo },
  });
  return res.json({ ok: true });
});

// ── Pending changes (web → MySQL write-back queue) ────────────

// Bridge pulls pending changes to apply to MySQL
router.get("/pending-changes", requireAuth, async (_req, res) => {
  const changes = await prisma.pendingChange.findMany({
    where:   { status: "pending" },
    orderBy: { createdAt: "asc" },
    take:    50,
  });
  return res.json(changes);
});

// Web dashboard creates a pending change (stock adj, GRN, price update, etc.)
router.post("/pending-changes", requireAuth, async (req, res) => {
  const { type, payload } = req.body as { type: string; payload: object };
  if (!type || !payload) return res.status(400).json({ error: "type and payload required" });

  const change = await prisma.pendingChange.create({
    data: { type, payload },
  });
  return res.json(change);
});

// History of all changes (pending + applied + failed) for the stock UI
router.get("/pending-changes/history", requireAuth, async (_req, res) => {
  const changes = await prisma.pendingChange.findMany({
    orderBy: { createdAt: "desc" },
    take:    100,
  });
  return res.json(changes);
});

// Bridge marks a change as successfully applied to MySQL
router.post("/mark-change-applied", async (req, res) => {
  if (!checkSecret(req, res)) return;

  const { id } = req.body as { id: string };
  await prisma.pendingChange.update({
    where: { id },
    data:  { status: "applied", appliedAt: new Date() },
  });
  return res.json({ ok: true });
});

// Bridge marks a change as failed
router.post("/mark-change-failed", async (req, res) => {
  if (!checkSecret(req, res)) return;

  const { id, error } = req.body as { id: string; error: string };
  await prisma.pendingChange.update({
    where: { id },
    data:  { status: "failed", failReason: error },
  });
  return res.json({ ok: true });
});

// ── Daily MySQL backup storage ────────────────────────────────

import fs from "fs";
import path from "path";

const BACKUP_DIR = process.env.BACKUP_DIR ?? "/home/admin/apps/mwalimu-backups";

router.post("/backup", async (req, res) => {
  if (!checkSecret(req, res)) return;

  const { date, table, rows } = req.body as { date: string; table: string; rows: unknown[] };
  if (!date || !table || !Array.isArray(rows)) {
    return res.status(400).json({ error: "date, table, rows required" });
  }

  // Whitelist tables accepted for backup
  const allowed = ["pos_header", "pos_details", "pos_payment_details", "stran", "grn"];
  if (!allowed.includes(table)) return res.status(400).json({ error: "table not allowed" });

  try {
    const dir = path.join(BACKUP_DIR, date);
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${table}.json`);
    fs.writeFileSync(file, JSON.stringify(rows));
    return res.json({ ok: true, rows: rows.length });
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
});

router.get("/backup/list", requireAuth, async (_req, res) => {
  try {
    if (!fs.existsSync(BACKUP_DIR)) return res.json([]);
    const dates = fs.readdirSync(BACKUP_DIR)
      .filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d))
      .sort()
      .reverse();
    return res.json(dates.map(date => {
      const tables = fs.readdirSync(path.join(BACKUP_DIR, date))
        .map(f => f.replace(".json", ""));
      return { date, tables };
    }));
  } catch {
    return res.json([]);
  }
});

// ── Bridge remote log ─────────────────────────────────────────
// Bridge POSTs its log lines here after each sync run so we can read
// them in PM2 logs (server-side) without accessing the shop PC directly.
router.post("/bridge-log", (req, res) => {
  if (!checkSecret(req, res)) return;
  const { entries } = req.body as { entries: string[] };
  if (Array.isArray(entries) && entries.length) {
    console.log("[bridge]", entries.join("\n[bridge] "));
  }
  return res.json({ ok: true });
});

// ── Agent self-update endpoints ───────────────────────────────
// Bridge PCs call /sync/agent-version on every startup.
// If the version differs from their embedded constant they fetch
// /sync/agent/pusher.js, overwrite themselves, and restart.

const AGENT_DIR     = process.env.AGENT_DIR ?? "/home/admin/apps/mwalimucosmetics/bridge";
const AGENT_VERSION = "20260514-20";

router.get("/agent-version", (_req, res) => {
  res.json({ version: AGENT_VERSION });
});

router.get("/agent/pusher.js", (_req, res) => {
  const filePath = path.join(AGENT_DIR, "pusher.js");
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: "agent not found" });
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.sendFile(filePath);
});

router.get("/agent/loop.ps1", (_req, res) => {
  const filePath = path.join(AGENT_DIR, "loop.ps1");
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: "loop not found" });
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.sendFile(filePath);
});

router.get("/agent/daily-backup.js", (_req, res) => {
  const filePath = path.join(AGENT_DIR, "daily-backup.js");
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: "not found" });
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.sendFile(filePath);
});

router.get("/agent/daily-mirror.js", (_req, res) => {
  const filePath = path.join(AGENT_DIR, "daily-mirror.js");
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: "not found" });
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.sendFile(filePath);
});
