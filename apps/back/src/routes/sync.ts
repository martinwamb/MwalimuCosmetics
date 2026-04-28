import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { requireAuth } from "../lib/authz.js";

export const router = Router();

const SYNC_SECRET = process.env.SYNC_SECRET ?? "mwalimu-sync-secret";

const metricsSchema = z.object({
  forDate: z.string(),
  transactions: z.number(),
  totalSales: z.number(),
  cashSales: z.number(),
  mpesaSales: z.number(),
  otherSales: z.number(),
  paymentBreakdown: z.array(z.object({
    name: z.string(),
    transactions: z.number(),
    total: z.number(),
  })),
  topProducts: z.array(z.object({
    code: z.string(),
    name: z.string(),
    qtySold: z.number(),
    revenue: z.number(),
  })),
  byStaff: z.array(z.object({
    staff: z.string(),
    transactions: z.number(),
    total: z.number(),
  })),
});

// Bridge PCs push metrics here using the sync secret
router.post("/metrics", async (req, res) => {
  const secret = req.headers["x-sync-secret"];
  if (secret !== SYNC_SECRET) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const parsed = metricsSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  const data = parsed.data;

  // Upsert — replace today's snapshot if it already exists
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

// ── Product catalogue sync ──────────────────────────────────
router.post("/products", async (req, res) => {
  const secret = req.headers["x-sync-secret"];
  if (secret !== SYNC_SECRET) return res.status(401).json({ error: "Unauthorized" });

  const { products } = req.body as { products: Array<{ sku: string; name: string; price: number; category: string; stockQty: number }> };
  if (!Array.isArray(products)) return res.status(400).json({ error: "products must be array" });

  let upserted = 0;
  for (const p of products) {
    if (!p.sku || !p.name || p.price <= 0) continue;

    // Ensure category exists
    let cat = await prisma.category.findFirst({ where: { name: { equals: p.category, mode: "insensitive" } } });
    if (!cat) cat = await prisma.category.create({ data: { name: p.category } });

    await prisma.product.upsert({
      where: { sku: p.sku },
      update: {
        name:       p.name,
        price:      p.price,
        stockQty:   p.stockQty,
        categoryId: cat.id,
        status:     p.stockQty > 0 ? "ACTIVE" : "ACTIVE",
      },
      create: {
        sku:        p.sku,
        name:       p.name,
        price:      p.price,
        cost:       0,
        stockQty:   p.stockQty,
        categoryId: cat.id,
        status:     "ACTIVE",
      },
    });
    upserted++;
  }

  return res.json({ ok: true, upserted });
});

// ── Unsynced web sales (for writeback to MySQL) ─────────────
router.get("/unsynced-sales", async (req, res) => {
  const secret = req.headers["x-sync-secret"];
  const auth   = req.headers["authorization"];
  if (secret !== SYNC_SECRET && !auth) return res.status(401).json({ error: "Unauthorized" });

  const sales = await prisma.salesOrder.findMany({
    where:   { mysqlSynced: false, channel: "COUNTER" },
    orderBy: { createdAt: "asc" },
    take:    50,
    include: {
      items: { include: { product: { select: { sku: true, name: true } } } },
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
    items:          s.items.map(i => ({
      sku:         i.product.sku,
      productName: i.product.name,
      qty:         i.qty,
      unitPrice:   Number(i.unitPrice),
    })),
  })));
});

// ── Mark sale as synced ─────────────────────────────────────
router.post("/mark-synced", async (req, res) => {
  const secret = req.headers["x-sync-secret"];
  if (secret !== SYNC_SECRET) return res.status(401).json({ error: "Unauthorized" });

  const { orderId, mysqlReceiptNo } = req.body as { orderId: string; mysqlReceiptNo: string };
  await prisma.salesOrder.update({
    where: { id: orderId },
    data:  { mysqlSynced: true, mysqlReceiptNo },
  });
  return res.json({ ok: true });
});
