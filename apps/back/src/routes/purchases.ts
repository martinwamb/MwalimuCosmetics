import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { requireRoles } from "../lib/authz.js";

export const router = Router();

const itemSchema = z.object({
  productId: z.string(),
  qty: z.number().int().positive(),
  cost: z.number().nonnegative(),
});

const purchaseSchema = z.object({
  supplierId: z.string(),
  notes: z.string().optional(),
  items: z.array(itemSchema).min(1),
});

// List purchases
router.get("/", requireRoles(["ADMIN", "ACCOUNTS"]), async (_req, res) => {
  try {
    const purchases = await prisma.purchase.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        supplier: true,
        items: { include: { product: { select: { id: true, name: true, sku: true } } } },
      },
    });
    res.json({ data: purchases });
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? "Failed to load purchases" });
  }
});

// Create purchase (receive stock)
router.post("/", requireRoles(["ADMIN", "ACCOUNTS"]), async (req, res) => {
  const parsed = purchaseSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const { supplierId, notes, items } = parsed.data;
  const totalCost = items.reduce((sum, i) => sum + i.cost * i.qty, 0);

  try {
    const purchase = await prisma.$transaction(async (tx) => {
      const p = await tx.purchase.create({
        data: {
          supplierId,
          totalCost,
          notes,
          items: {
            create: items.map((i) => ({ productId: i.productId, qty: i.qty, cost: i.cost })),
          },
        },
        include: { supplier: true, items: { include: { product: { select: { id: true, name: true, sku: true } } } } },
      });

      // Increment stock for each item received
      await Promise.all(
        items.map((i) =>
          tx.product.update({
            where: { id: i.productId },
            data: { stockQty: { increment: i.qty } },
          })
        )
      );

      // Log inventory movements
      await tx.inventoryMovement.createMany({
        data: items.map((i) => ({
          productId: i.productId,
          delta: i.qty,
          reason: `Purchase ${p.id}`,
        })),
      });

      return p;
    });

    res.status(201).json({ data: purchase });
  } catch (err: any) {
    res.status(400).json({ error: err?.message ?? "Failed to create purchase" });
  }
});

// Delete purchase (does NOT reverse stock — use inventory adjustment for that)
router.delete("/:id", requireRoles(["ADMIN"]), async (req, res) => {
  try {
    await prisma.purchaseItem.deleteMany({ where: { purchaseId: req.params.id } });
    await prisma.purchase.delete({ where: { id: req.params.id } });
    res.status(204).send();
  } catch (err: any) {
    res.status(400).json({ error: err?.message ?? "Failed to delete purchase" });
  }
});
