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

  let data = parsed.data;

  // Old agent detection: tax=0, profit=0, purchases=0, draftTransactions=0.
  // Old agents lack posted=1 filtering so totalSales includes drafts, and their
  // paymentBreakdown covers all transactions — meaning breakdown and totalSales
  // will never reconcile with each other.
  // When detected: reject everything from the old agent and keep the entire
  // existing accurate snapshot intact. Nothing the old agent sends is usable.
  const isOldAgent = data.tax === 0 && data.profit === 0 && data.purchases === 0 && data.draftTransactions === 0;
  if (isOldAgent) {
    const existing = await prisma.metricsSnapshot.findFirst({ where: { forDate: data.forDate } });
    const ex = existing as any;
    if (existing && (existing.tax > 0 || ex.profit > 0 || ex.purchases > 0)) {
      // Silently ignore the old agent push — accurate data is already stored
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

// ── Product catalogue sync ────────────────────────────────────

router.post("/products", async (req, res) => {
  if (!checkSecret(req, res)) return;

  const { products } = req.body as {
    products: Array<{ sku: string; name: string; price: number; category: string; stockQty: number }>;
  };
  if (!Array.isArray(products)) return res.status(400).json({ error: "products must be array" });

  let upserted = 0;
  for (const p of products) {
    if (!p.sku || !p.name || p.price <= 0) continue;

    let cat = await prisma.category.findFirst({
      where: { name: { equals: p.category, mode: "insensitive" } },
    });
    if (!cat) cat = await prisma.category.create({ data: { name: p.category } });

    await prisma.product.upsert({
      where:  { sku: p.sku },
      update: {
        name:       p.name,
        price:      p.price,
        stockQty:   p.stockQty,
        categoryId: cat.id,
        status:     p.stockQty > 0 ? "ACTIVE" : "INACTIVE",
      },
      create: {
        sku:        p.sku,
        name:       p.name,
        price:      p.price,
        cost:       0,
        stockQty:   p.stockQty,
        categoryId: cat.id,
        status:     p.stockQty > 0 ? "ACTIVE" : "INACTIVE",
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

// Web dashboard creates a pending change (stock adj, price update, etc.)
router.post("/pending-changes", requireAuth, async (req, res) => {
  const { type, payload } = req.body as { type: string; payload: object };
  if (!type || !payload) return res.status(400).json({ error: "type and payload required" });

  const change = await prisma.pendingChange.create({
    data: { type, payload },
  });
  return res.json(change);
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
  const allowed = ["pos_header", "pos_details", "pos_payment_details", "stran"];
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

// ── Agent self-update endpoints ───────────────────────────────
// Bridge PCs call /sync/agent-version on every startup.
// If the version differs from their embedded constant they fetch
// /sync/agent/pusher.js, overwrite themselves, and restart.

const AGENT_DIR     = process.env.AGENT_DIR ?? "/home/admin/apps/mwalimucosmetics/bridge";
const AGENT_VERSION = "20260501-5";

router.get("/agent-version", (_req, res) => {
  res.json({ version: AGENT_VERSION });
});

router.get("/agent/pusher.js", (_req, res) => {
  const filePath = path.join(AGENT_DIR, "pusher.js");
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: "agent not found" });
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.sendFile(filePath);
});
