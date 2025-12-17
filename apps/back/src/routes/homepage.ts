import { Router } from "express";
import { z } from "zod";

import { requireRoles } from "../lib/authz.js";
import { prisma } from "../lib/prisma.js";

const bannerSchema = z.object({
  title: z.string().min(1),
  subtext: z.string().optional(),
  ctaText: z.string().optional(),
  ctaLink: z.string().optional(),
  imageUrl: z.string().min(1),
  enabled: z.boolean().optional(),
  sortOrder: z.number().int().optional()
});

const sectionItemSchema = z.object({
  label: z.string().min(1),
  imageUrl: z.string().optional(),
  linkType: z.enum(["URL", "CATEGORY", "PRODUCT", "FILTER"]).optional(),
  linkTarget: z.string().optional(),
  badge: z.string().optional(),
  sortOrder: z.number().int().optional()
});

const sectionSchema = z.object({
  type: z.enum(["CATEGORY", "NEED", "FEATURED_COLLECTION", "BEST_SELLERS", "PRICE"]),
  title: z.string().min(1),
  subtitle: z.string().optional(),
  enabled: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
  items: z.array(sectionItemSchema).max(12).optional()
});

const sectionUpdateSchema = sectionSchema.partial();

export const router = Router();

function formatBanner(banner: any) {
  return {
    id: banner.id,
    title: banner.title,
    subtext: banner.subtext,
    ctaText: banner.ctaText,
    ctaLink: banner.ctaLink,
    imageUrl: banner.imageUrl,
    enabled: banner.enabled,
    sortOrder: banner.sortOrder,
    createdAt: banner.createdAt,
    updatedAt: banner.updatedAt
  };
}

function formatSection(section: any) {
  return {
    id: section.id,
    type: section.type,
    title: section.title,
    subtitle: section.subtitle,
    enabled: section.enabled,
    sortOrder: section.sortOrder,
    createdAt: section.createdAt,
    updatedAt: section.updatedAt,
    items:
      section.items
        ?.map((item: any) => ({
          id: item.id,
          label: item.label,
          imageUrl: item.imageUrl,
          linkType: item.linkType,
          linkTarget: item.linkTarget,
          badge: item.badge,
          sortOrder: item.sortOrder,
          createdAt: item.createdAt,
          updatedAt: item.updatedAt
        }))
        .sort((a: any, b: any) => a.sortOrder - b.sortOrder || a.createdAt - b.createdAt) ?? []
  };
}

async function countEnabledBanners(excludeId?: string) {
  return prisma.homepageBanner.count({
    where: {
      enabled: true,
      id: excludeId ? { not: excludeId } : undefined
    }
  });
}

router.get("/", async (_req, res) => {
  const [banners, sections] = await Promise.all([
    prisma.homepageBanner.findMany({
      where: { enabled: true },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      take: 5
    }),
    prisma.homepageSection.findMany({
      where: { enabled: true },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      include: { items: true }
    })
  ]);

  res.json({
    banners: banners.map(formatBanner),
    sections: sections.map(formatSection),
    limits: { minBanners: 3, maxBanners: 5 }
  });
});

router.get("/banners", requireRoles(["ADMIN"]), async (_req, res) => {
  const banners = await prisma.homepageBanner.findMany({
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }]
  });
  res.json({ data: banners.map(formatBanner) });
});

router.post("/banners", requireRoles(["ADMIN"]), async (req, res) => {
  const parsed = bannerSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  if (parsed.data.enabled !== false) {
    const enabledCount = await countEnabledBanners();
    if (enabledCount >= 5) {
      return res.status(400).json({ error: "Maximum of 5 banners can be enabled at once." });
    }
  }

  const created = await prisma.homepageBanner.create({
    data: {
      title: parsed.data.title,
      subtext: parsed.data.subtext,
      ctaText: parsed.data.ctaText,
      ctaLink: parsed.data.ctaLink,
      imageUrl: parsed.data.imageUrl,
      enabled: parsed.data.enabled ?? true,
      sortOrder: parsed.data.sortOrder ?? 0
    }
  });
  res.status(201).json({ data: formatBanner(created) });
});

router.put("/banners/:id", requireRoles(["ADMIN"]), async (req, res) => {
  const parsed = bannerSchema.partial().safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  if (parsed.data.enabled === true) {
    const enabledCount = await countEnabledBanners(req.params.id);
    if (enabledCount >= 5) {
      return res.status(400).json({ error: "Maximum of 5 banners can be enabled at once." });
    }
  }

  const updated = await prisma.homepageBanner.update({
    where: { id: req.params.id },
    data: {
      title: parsed.data.title ?? undefined,
      subtext: parsed.data.subtext,
      ctaText: parsed.data.ctaText,
      ctaLink: parsed.data.ctaLink,
      imageUrl: parsed.data.imageUrl,
      enabled: parsed.data.enabled,
      sortOrder: parsed.data.sortOrder
    }
  });
  res.json({ data: formatBanner(updated) });
});

router.patch("/banners/reorder", requireRoles(["ADMIN"]), async (req, res) => {
  const arrSchema = z.array(z.object({ id: z.string().min(1), sortOrder: z.number().int() })).min(1);
  const parsed = arrSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  await prisma.$transaction(
    parsed.data.map((item) =>
      prisma.homepageBanner.update({
        where: { id: item.id },
        data: { sortOrder: item.sortOrder }
      })
    )
  );
  res.json({ ok: true });
});

router.get("/sections", requireRoles(["ADMIN"]), async (_req, res) => {
  const sections = await prisma.homepageSection.findMany({
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    include: { items: true }
  });
  res.json({ data: sections.map(formatSection) });
});

router.post("/sections", requireRoles(["ADMIN"]), async (req, res) => {
  const parsed = sectionSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  const created = await prisma.homepageSection.create({
    data: {
      type: parsed.data.type,
      title: parsed.data.title,
      subtitle: parsed.data.subtitle,
      enabled: parsed.data.enabled ?? true,
      sortOrder: parsed.data.sortOrder ?? 0,
      items: parsed.data.items
        ? {
            create: parsed.data.items.map((item, idx) => ({
              label: item.label,
              imageUrl: item.imageUrl,
              linkType: item.linkType ?? "URL",
              linkTarget: item.linkTarget,
              badge: item.badge,
              sortOrder: item.sortOrder ?? idx
            }))
          }
        : undefined
    },
    include: { items: true }
  });

  res.status(201).json({ data: formatSection(created) });
});

router.put("/sections/:id", requireRoles(["ADMIN"]), async (req, res) => {
  const parsed = sectionUpdateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  const updates: any = {
    type: parsed.data.type,
    title: parsed.data.title,
    subtitle: parsed.data.subtitle,
    enabled: parsed.data.enabled,
    sortOrder: parsed.data.sortOrder
  };

  let withItems = null;
  if (parsed.data.items) {
    withItems = parsed.data.items;
  }

  const result = await prisma.$transaction(async (tx) => {
    if (withItems) {
      await tx.homepageSectionItem.deleteMany({ where: { sectionId: req.params.id } });
    }

    const updatedSection = await tx.homepageSection.update({
      where: { id: req.params.id },
      data: updates,
      include: { items: true }
    });

    if (withItems) {
      await tx.homepageSectionItem.createMany({
        data: withItems.map((item, idx) => ({
          sectionId: req.params.id,
          label: item.label,
          imageUrl: item.imageUrl,
          linkType: item.linkType ?? "URL",
          linkTarget: item.linkTarget,
          badge: item.badge,
          sortOrder: item.sortOrder ?? idx
        }))
      });
    }

    const refreshed = await tx.homepageSection.findUnique({
      where: { id: req.params.id },
      include: { items: true }
    });

    return refreshed;
  });

  res.json({ data: formatSection(result) });
});

router.patch("/sections/reorder", requireRoles(["ADMIN"]), async (req, res) => {
  const arrSchema = z.array(z.object({ id: z.string().min(1), sortOrder: z.number().int() })).min(1);
  const parsed = arrSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  await prisma.$transaction(
    parsed.data.map((item) =>
      prisma.homepageSection.update({
        where: { id: item.id },
        data: { sortOrder: item.sortOrder }
      })
    )
  );
  res.json({ ok: true });
});

router.delete("/sections/:id", requireRoles(["ADMIN"]), async (req, res) => {
  await prisma.$transaction([
    prisma.homepageSectionItem.deleteMany({ where: { sectionId: req.params.id } }),
    prisma.homepageSection.delete({ where: { id: req.params.id } })
  ]);
  res.status(204).send();
});
