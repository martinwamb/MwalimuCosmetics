import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { requireRoles } from "../lib/authz.js";

export const router = Router();

// Recent inventory movements
router.get("/movements", requireRoles(["ADMIN", "ACCOUNTS"]), async (req, res) => {
  try {
    const take = Math.min(Number(req.query.take ?? 100), 500);
    const movements = await prisma.inventoryMovement.findMany({
      orderBy: { createdAt: "desc" },
      take,
      include: { product: { select: { id: true, name: true, sku: true } } },
    });
    res.json({ data: movements });
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? "Failed to load movements" });
  }
});

// Stock summary — all products with their current stockQty
router.get("/stock", requireRoles(["ADMIN", "ACCOUNTS", "SALES"]), async (_req, res) => {
  try {
    const products = await prisma.product.findMany({
      where: { status: { in: ["ACTIVE", "INACTIVE"] } },
      select: { id: true, name: true, sku: true, stockQty: true, cost: true, price: true, imageUrl: true },
      orderBy: { name: "asc" },
    });
    res.json({ data: products });
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? "Failed to load stock" });
  }
});

const adjustSchema = z.object({
  productId: z.string(),
  delta: z.number().int(),
  reason: z.string().min(1),
});

// Manual stock adjustment
router.post("/adjust", requireRoles(["ADMIN", "ACCOUNTS"]), async (req, res) => {
  const parsed = adjustSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const { productId, delta, reason } = parsed.data;

  try {
    const [movement] = await prisma.$transaction([
      prisma.inventoryMovement.create({ data: { productId, delta, reason } }),
      prisma.product.update({
        where: { id: productId },
        data: { stockQty: { increment: delta } },
      }),
    ]);
    res.status(201).json({ data: movement });
  } catch (err: any) {
    res.status(400).json({ error: err?.message ?? "Failed to adjust stock" });
  }
});
