import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { requireAuth } from "../lib/authz.js";

export const router = Router();

// All POS routes require staff login
router.use(requireAuth);

// ── Product search ──────────────────────────────────────────
router.get("/products", async (req, res) => {
  const q        = String(req.query.q ?? "").trim();
  const category = String(req.query.category ?? "").trim();
  const page     = Math.max(1, Number(req.query.page ?? 1));
  const limit    = Math.min(100, Math.max(1, Number(req.query.limit ?? 48)));
  const skip     = (page - 1) * limit;

  const where: any = { status: "ACTIVE" };
  if (q) {
    where.OR = [
      { name: { contains: q, mode: "insensitive" } },
      { sku:  { contains: q, mode: "insensitive" } },
    ];
  }
  if (category) {
    where.category = { name: { equals: category, mode: "insensitive" } };
  }

  const [items, total] = await Promise.all([
    prisma.product.findMany({
      where,
      skip,
      take: limit,
      orderBy: { name: "asc" },
      select: {
        id: true, name: true, sku: true, price: true,
        stockQty: true, imageUrl: true,
        category: { select: { name: true } },
      },
    }),
    prisma.product.count({ where }),
  ]);

  return res.json({ items, total, page, pages: Math.ceil(total / limit) });
});

// ── Categories ──────────────────────────────────────────────
router.get("/categories", async (_req, res) => {
  const cats = await prisma.category.findMany({
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });
  return res.json(cats);
});

// ── Create sale ─────────────────────────────────────────────
const saleItemSchema = z.object({
  productId: z.string(),
  sku:       z.string(),
  name:      z.string(),
  qty:       z.number().int().positive(),
  unitPrice: z.number().positive(),
  discount:  z.number().min(0).default(0),
});

const createSaleSchema = z.object({
  items:          z.array(saleItemSchema).min(1),
  paymentDetails: z.object({
    cash:           z.number().min(0).default(0),
    mpesa:          z.number().min(0).default(0),
    coop:           z.number().min(0).default(0),
    equity_justann: z.number().min(0).default(0),
    equity_mwalimu: z.number().min(0).default(0),
    kcb:            z.number().min(0).default(0),
    ref:            z.string().optional(),
  }),
  amountPaid: z.number().min(0),
  notes:      z.string().optional(),
});

router.post("/sale", async (req: any, res) => {
  const parsed = createSaleSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const { items, paymentDetails, amountPaid, notes } = parsed.data;
  const userId = req.auth?.sub;

  const subtotal = items.reduce((s, i) => s + (i.unitPrice - i.discount) * i.qty, 0);
  const total    = subtotal;
  const change   = Math.max(0, amountPaid - total);

  const order = await prisma.salesOrder.create({
    data: {
      channel:        "COUNTER",
      status:         "PAID",
      paymentStatus:  "PAID",
      subtotal,
      tax:            0,
      discount:       0,
      total,
      amountPaid,
      changeDue:      change,
      paymentDetails,
      notes,
      createdById:    userId ?? null,
      mysqlSynced:    false,
      items: {
        create: items.map(i => ({
          productId: i.productId,
          qty:       i.qty,
          unitPrice: i.unitPrice,
          discount:  i.discount,
        })),
      },
    },
    include: { items: { include: { product: { select: { name: true, sku: true } } } } },
  });

  // Decrement stock in PostgreSQL
  for (const item of items) {
    await prisma.product.update({
      where: { id: item.productId },
      data:  { stockQty: { decrement: item.qty } },
    }).catch(() => { /* ignore if product not found */ });
  }

  return res.json(order);
});

// ── Get single sale (used to poll for mysqlReceiptNo after bridge sync) ─
router.get("/sale/:id", async (req, res) => {
  const order = await prisma.salesOrder.findUnique({
    where: { id: req.params.id },
    include: {
      items: { include: { product: { select: { name: true, sku: true } } } },
      createdBy: { select: { name: true } },
    },
  });
  if (!order) return res.status(404).json({ error: "Not found" });
  return res.json(order);
});

// ── Sales history ───────────────────────────────────────────
router.get("/sales", async (req, res) => {
  const date  = String(req.query.date ?? new Date().toISOString().slice(0, 10));
  const start = new Date(date + "T00:00:00.000Z");
  const end   = new Date(date + "T23:59:59.999Z");

  const sales = await prisma.salesOrder.findMany({
    where: {
      channel:   "COUNTER",
      createdAt: { gte: start, lte: end },
    },
    orderBy: { createdAt: "desc" },
    include: {
      items: {
        include: { product: { select: { name: true, sku: true } } },
      },
      createdBy: { select: { name: true } },
    },
  });

  return res.json(sales);
});

// ── Unsynced sales (for bridge PC to pull and write to MySQL) ─
router.get("/unsynced", async (_req, res) => {
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

// ── Single receipt ───────────────────────────────────────────
router.get("/receipt/:id", async (req, res) => {
  const order = await prisma.salesOrder.findUnique({
    where: { id: req.params.id },
    include: {
      items: { include: { product: { select: { name: true, sku: true } } } },
      createdBy: { select: { name: true } },
    },
  });
  if (!order) return res.status(404).json({ error: "Not found" });
  return res.json(order);
});
