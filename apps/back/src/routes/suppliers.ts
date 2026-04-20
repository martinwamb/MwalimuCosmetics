import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { requireRoles } from "../lib/authz.js";

export const router = Router();

const supplierSchema = z.object({
  name: z.string().min(1),
  email: z.string().email().optional(),
  phone: z.string().optional(),
});

router.get("/", requireRoles(["ADMIN", "ACCOUNTS"]), async (_req, res) => {
  try {
    const suppliers = await prisma.supplier.findMany({
      orderBy: { name: "asc" },
      include: { _count: { select: { purchases: true } } },
    });
    res.json({ data: suppliers });
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? "Failed to load suppliers" });
  }
});

router.post("/", requireRoles(["ADMIN", "ACCOUNTS"]), async (req, res) => {
  const parsed = supplierSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  try {
    const supplier = await prisma.supplier.create({ data: parsed.data });
    res.status(201).json({ data: supplier });
  } catch (err: any) {
    res.status(400).json({ error: err?.message ?? "Failed to create supplier" });
  }
});

router.put("/:id", requireRoles(["ADMIN", "ACCOUNTS"]), async (req, res) => {
  const parsed = supplierSchema.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  try {
    const supplier = await prisma.supplier.update({ where: { id: req.params.id }, data: parsed.data });
    res.json({ data: supplier });
  } catch (err: any) {
    res.status(400).json({ error: err?.message ?? "Failed to update supplier" });
  }
});

router.delete("/:id", requireRoles(["ADMIN"]), async (req, res) => {
  try {
    await prisma.supplier.delete({ where: { id: req.params.id } });
    res.status(204).send();
  } catch (err: any) {
    res.status(400).json({ error: err?.message ?? "Failed to delete supplier" });
  }
});
