import { Prisma } from "@prisma/client";
import { Router } from "express";
import { z } from "zod";

import { requireRoles, verifyAuth } from "../lib/authz.js";
import { prisma } from "../lib/prisma.js";

const productCreateSchema = z.object({
  name: z.string().min(1),
  sku: z.string().min(1),
  price: z.number().positive(),
  cost: z.number().nonnegative(),
  description: z.string().optional(),
  imageUrl: z.string().min(1).optional(),
  featured: z.boolean().optional(),
  stockQty: z.number().int().nonnegative().default(0),
  category: z.string().min(1).default("General"),
  status: z.enum(["ACTIVE", "INACTIVE", "ARCHIVED"]).optional(),
  variants: z
    .array(
      z.object({
        name: z.string().min(1),
        imageUrl: z.string().min(1).optional(),
        price: z.number().positive().optional()
      })
    )
    .optional()
});

const productUpdateSchema = productCreateSchema.partial();

export const router = Router();

function formatProduct(product: any, includeCost = false) {
  const base: any = {
    id: product.id,
    name: product.name,
    sku: product.sku,
    description: product.description,
    featured: product.featured,
    imageUrl: product.imageUrl,
    price: parseFloat(product.price.toString()),
    stockQty: product.stockQty,
    status: product.status,
    category: product.category?.name ?? null,
    createdAt: product.createdAt,
    updatedAt: product.updatedAt,
    variants:
      product.variants?.map((v: any) => ({
        id: v.id,
        name: v.name,
        imageUrl: v.imageUrl,
        price: v.price ? parseFloat(v.price.toString()) : null
      })) ?? []
  };
  if (includeCost) {
    base.cost = parseFloat(product.cost.toString());
  }
  return base;
}

async function ensureCategory(name: string) {
  const trimmed = name.trim();
  const existing = await prisma.category.findUnique({ where: { name: trimmed } });
  if (existing) return existing;
  return prisma.category.create({ data: { name: trimmed } });
}

router.get("/", async (req, res) => {
  const take = Math.min(Number(req.query.take ?? 50), 100);
  const skip = Number(req.query.skip ?? 0);
  const status = typeof req.query.status === "string" ? req.query.status : null;
  const search = typeof req.query.search === "string" ? req.query.search : null;
  const requester = verifyAuth(req.headers.authorization);
  const includeCost = requester?.role === "ADMIN";

  const where: any = {};
  if (status && ["ACTIVE", "INACTIVE", "ARCHIVED"].includes(status)) {
    where.status = status;
  } else {
    where.status = { in: ["ACTIVE", "INACTIVE"] };
  }

  if (search) {
    where.OR = [
      { name: { contains: search, mode: "insensitive" } },
      { description: { contains: search, mode: "insensitive" } },
      { sku: { contains: search, mode: "insensitive" } }
    ];
  }

  const products = await prisma.product.findMany({
    where,
    include: { category: true, variants: true },
    orderBy: { createdAt: "desc" },
    take,
    skip
  });

  res.json({ data: products.map((product) => formatProduct(product, includeCost)) });
});

router.get("/:id", async (req, res) => {
  const requester = verifyAuth(req.headers.authorization);
  const includeCost = requester?.role === "ADMIN";

  const product = await prisma.product.findUnique({
    where: { id: req.params.id },
    include: { category: true, variants: true }
  });
  if (!product) return res.status(404).json({ error: "Not found" });
  res.json({ data: formatProduct(product, includeCost) });
});

router.post("/", requireRoles(["ADMIN"]), async (req, res) => {
  const parsed = productCreateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  const category = await ensureCategory(parsed.data.category);

  try {
    const created = await prisma.product.create({
      data: {
        name: parsed.data.name,
        sku: parsed.data.sku,
        description: parsed.data.description,
        featured: Boolean(parsed.data.featured),
        imageUrl: parsed.data.imageUrl,
        categoryId: category.id,
        price: new Prisma.Decimal(parsed.data.price),
        cost: new Prisma.Decimal(parsed.data.cost),
        stockQty: parsed.data.stockQty ?? 0,
        status: parsed.data.status ?? "ACTIVE",
        variants: parsed.data.variants
          ? {
              create: parsed.data.variants.map((v) => ({
                name: v.name,
                imageUrl: v.imageUrl,
                price: typeof v.price === "number" ? new Prisma.Decimal(v.price) : undefined
              }))
            }
          : undefined
      },
      include: { category: true, variants: true }
    });

    res.status(201).json({ data: formatProduct(created, true) });
  } catch (err: any) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return res.status(409).json({ error: "SKU must be unique" });
    }
    console.error("[products] create failed", err);
    res.status(500).json({ error: "Could not create product" });
  }
});

router.put("/:id", requireRoles(["ADMIN"]), async (req, res) => {
  const parsed = productUpdateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  const updates: any = {
    name: parsed.data.name,
    sku: parsed.data.sku,
    description: parsed.data.description,
    featured: parsed.data.featured,
    imageUrl: parsed.data.imageUrl,
    stockQty: parsed.data.stockQty,
    status: parsed.data.status
  };

  if (typeof parsed.data.price === "number") {
    updates.price = new Prisma.Decimal(parsed.data.price);
  }
  if (typeof parsed.data.cost === "number") {
    updates.cost = new Prisma.Decimal(parsed.data.cost);
  }

    if (parsed.data.category) {
      const category = await ensureCategory(parsed.data.category);
      updates.categoryId = category.id;
    }

    try {
      const updated = await prisma.product.update({
        where: { id: req.params.id },
        data: updates,
        include: { category: true, variants: true }
      });
      res.json({ data: formatProduct(updated, true) });
  } catch (err: any) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return res.status(409).json({ error: "SKU must be unique" });
    }
    console.error("[products] update failed", err);
    res.status(500).json({ error: "Could not update product" });
  }
});
