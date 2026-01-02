import { Prisma } from "@prisma/client";
import { Router } from "express";
import { z } from "zod";

import { requireRoles, verifyAuth } from "../lib/authz.js";
import { prisma } from "../lib/prisma.js";
import { ensureSystemTaxonomy, formatProduct, persistProductTags, validateStructuredTags } from "../lib/taxonomy.js";

const tagPayloadSchema = z.object({
  productType: z.string().min(1),
  careAreas: z.array(z.string().min(1)).min(1),
  benefits: z.array(z.string().min(1)).optional(),
  suitableFor: z.array(z.string().min(1)).optional(),
  ingredients: z.array(z.string().min(1)).optional(),
  marketingTags: z.array(z.string().min(1)).optional()
});

const productCreateSchema = z.object({
  name: z.string().min(1),
  brand: z.string().optional(),
  sku: z.string().min(1),
  slug: z.string().min(1).optional(),
  price: z.number().positive(),
  compareAtPrice: z.number().positive().optional(),
  currency: z.string().min(1).default("KES"),
  cost: z.number().nonnegative(),
  shortDescription: z.string().max(160).optional(),
  description: z.string().optional(),
  imageUrl: z.string().min(1).optional(),
  galleryImages: z.array(z.string().min(1)).optional(),
  featured: z.boolean().optional(),
  stockQty: z.number().int().nonnegative().default(0),
  status: z.enum(["DRAFT", "ACTIVE", "INACTIVE", "ARCHIVED"]).optional(),
  tags: tagPayloadSchema,
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

function slugify(input: string) {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-+/g, "-");
}

async function generateUniqueSlug(base: string | undefined, fallback: string | undefined, skipId?: string) {
  const candidateSource = base?.trim() || fallback?.trim() || "product";
  let slug = slugify(candidateSource);
  if (!slug) slug = `product-${Date.now()}`;

  let attempt = 0;
  // Ensure uniqueness; skip current record if updating
  // Add short suffix when colliding
  while (true) {
    const suffix = attempt === 0 ? "" : `-${attempt}`;
    const candidate = `${slug}${suffix}`;
    const existing = await prisma.product.findUnique({ where: { slug: candidate } });
    if (!existing || (skipId && existing.id === skipId)) {
      return candidate;
    }
    attempt += 1;
  }
}

router.get("/", async (req, res) => {
  const take = Math.min(Number(req.query.take ?? 50), 100);
  const skip = Number(req.query.skip ?? 0);
  const status = typeof req.query.status === "string" ? req.query.status : null;
  const search = typeof req.query.search === "string" ? req.query.search : null;
  const requester = verifyAuth(req.headers.authorization);
  const includeCost = requester?.role === "ADMIN";

  const where: any = {};
  if (status && ["DRAFT", "ACTIVE", "INACTIVE", "ARCHIVED"].includes(status)) {
    where.status = status;
  } else {
    where.status = { in: ["DRAFT", "ACTIVE", "INACTIVE"] };
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
    include: { productTags: { include: { tag: { include: { group: true } } } }, variants: true },
    orderBy: { createdAt: "desc" },
    take,
    skip
  });

  res.json({ data: products.map((product: any) => formatProduct(product, includeCost)) });
});

router.get("/:id", async (req, res) => {
  const requester = verifyAuth(req.headers.authorization);
  const includeCost = requester?.role === "ADMIN";

  const product = await prisma.product.findFirst({
    where: {
      OR: [
        { id: req.params.id },
        { slug: req.params.id },
        { sku: req.params.id }
      ]
    },
    include: { productTags: { include: { tag: { include: { group: true } } } }, variants: true }
  });
  if (!product) return res.status(404).json({ error: "Not found" });
  res.json({ data: formatProduct(product, includeCost) });
});

router.post("/", requireRoles(["ADMIN", "ACCOUNTS"]), async (req, res) => {
  const parsed = productCreateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  const slug = await generateUniqueSlug(parsed.data.slug ?? parsed.data.name, parsed.data.sku);
  const tagValidation = validateStructuredTags(parsed.data.tags ?? {});
  if (!tagValidation.ok) {
    return res.status(400).json({ error: tagValidation.errors });
  }

  try {
    const created = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      await ensureSystemTaxonomy();
      const product = await tx.product.create({
        data: {
          name: parsed.data.name,
          brand: parsed.data.brand,
          sku: parsed.data.sku,
          slug,
          shortDescription: parsed.data.shortDescription,
          description: parsed.data.description,
          featured: Boolean(parsed.data.featured),
          imageUrl: parsed.data.imageUrl,
          galleryImages: parsed.data.galleryImages ?? [],
          price: parsed.data.price,
          compareAtPrice: parsed.data.compareAtPrice,
          currency: parsed.data.currency ?? "KES",
          cost: parsed.data.cost,
          stockQty: parsed.data.stockQty ?? 0,
          status: parsed.data.status ?? "ACTIVE",
          variants: parsed.data.variants
            ? {
                create: parsed.data.variants.map((v) => ({
                  name: v.name,
                  imageUrl: v.imageUrl,
                  price: typeof v.price === "number" ? v.price : undefined
                }))
              }
            : undefined
        },
        include: { productTags: { include: { tag: { include: { group: true } } } }, variants: true }
      });

      await persistProductTags(product.id, tagValidation.normalized, tx);
      const refreshed = await tx.product.findUnique({
        where: { id: product.id },
        include: { productTags: { include: { tag: { include: { group: true } } } }, variants: true }
      });
      return refreshed!;
    });

    res.status(201).json({ data: formatProduct(created, true) });
  } catch (err: any) {
    if ((err as any)?.code === "P2002") {
      return res.status(409).json({ error: "SKU must be unique" });
    }
    console.error("[products] create failed", err);
    res.status(500).json({ error: "Could not create product" });
  }
});

router.put("/:id", requireRoles(["ADMIN", "ACCOUNTS"]), async (req, res) => {
  const parsed = productUpdateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  const updates: any = {
    name: parsed.data.name,
    brand: parsed.data.brand,
    sku: parsed.data.sku,
    slug: parsed.data.slug,
    shortDescription: parsed.data.shortDescription,
    description: parsed.data.description,
    featured: parsed.data.featured,
    imageUrl: parsed.data.imageUrl,
    galleryImages: parsed.data.galleryImages,
    stockQty: parsed.data.stockQty,
    status: parsed.data.status,
    compareAtPrice: parsed.data.compareAtPrice,
    currency: parsed.data.currency
  };

  if (typeof parsed.data.price === "number") {
    updates.price = parsed.data.price;
  }
  if (typeof parsed.data.cost === "number") {
    updates.cost = parsed.data.cost;
  }

  try {
    let normalizedTags = null;
    if (parsed.data.tags) {
      const validation = validateStructuredTags(parsed.data.tags);
      if (!validation.ok) {
        return res.status(400).json({ error: validation.errors });
      }
      normalizedTags = validation.normalized;
    }

    if (updates.slug) {
      updates.slug = await generateUniqueSlug(updates.slug, parsed.data.sku, req.params.id);
    }

    const updated = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const product = await tx.product.update({
        where: { id: req.params.id },
        data: updates,
        include: { productTags: { include: { tag: { include: { group: true } } } }, variants: true }
      });
      if (normalizedTags) {
        await ensureSystemTaxonomy();
        await persistProductTags(product.id, normalizedTags, tx);
      }
      const refreshed = await tx.product.findUnique({
        where: { id: product.id },
        include: { productTags: { include: { tag: { include: { group: true } } } }, variants: true }
      });
      return refreshed!;
    });
    res.json({ data: formatProduct(updated, true) });
  } catch (err: any) {
    if ((err as any)?.code === "P2002") {
      return res.status(409).json({ error: "SKU must be unique" });
    }
    console.error("[products] update failed", err);
    res.status(500).json({ error: "Could not update product" });
  }
});

router.delete("/:id", requireRoles(["ADMIN"]), async (req, res) => {
  try {
    await prisma.product.delete({ where: { id: req.params.id } });
    res.status(204).send();
  } catch (err: any) {
    if ((err as any)?.code === "P2025") {
      return res.status(404).json({ error: "Not found" });
    }
    console.error("[products] delete failed", err);
    res.status(500).json({ error: "Could not delete product" });
  }
});
