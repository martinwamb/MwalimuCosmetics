import { Router } from "express";
import { z } from "zod";

import { requireRoles } from "../lib/authz.js";
import { prisma } from "../lib/prisma.js";
import { ensureSystemTaxonomy } from "../lib/taxonomy.js";

export const router = Router();

const tagCreateSchema = z.object({
  value: z.string().min(1).regex(/^[a-z0-9_]+$/, "Use lowercase letters, numbers, and underscores only."),
  label: z.string().min(1).optional()
});

const tagUpdateSchema = z.object({
  label: z.string().min(1)
});

function toLabel(value: string) {
  return value
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase())
    .trim();
}

router.get("/groups", requireRoles(["ADMIN"]), async (req, res) => {
  await ensureSystemTaxonomy();
  const includeTags = req.query.includeTags === "true";
  if (includeTags) {
    const groups = await prisma.tagGroup.findMany({
      orderBy: { name: "asc" },
      include: { tags: { orderBy: { sortOrder: "asc" } } }
    });

    return res.json({
      data: groups.map((group) => ({
        id: group.id,
        code: group.code,
        name: group.name,
        description: group.description,
        selection: group.selection,
        required: group.required,
        editable: group.editable,
        tags: group.tags.map((tag) => ({
          id: tag.id,
          value: tag.value,
          label: tag.label,
          isSystem: tag.isSystem,
          sortOrder: tag.sortOrder
        }))
      }))
    });
  }

  const groups = await prisma.tagGroup.findMany({
    orderBy: { name: "asc" }
  });

  return res.json({
    data: groups.map((group) => ({
      id: group.id,
      code: group.code,
      name: group.name,
      description: group.description,
      selection: group.selection,
      required: group.required,
      editable: group.editable,
      tags: undefined
    }))
  });
});

router.post("/groups/:groupId/tags", requireRoles(["ADMIN"]), async (req, res) => {
  const parsed = tagCreateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  const group = await prisma.tagGroup.findUnique({ where: { id: req.params.groupId } });
  if (!group) return res.status(404).json({ error: "Tag group not found." });
  if (!group.editable) return res.status(400).json({ error: "Tags in this group are fixed." });

  try {
    const created = await prisma.tag.create({
      data: {
        value: parsed.data.value,
        label: parsed.data.label?.trim() || toLabel(parsed.data.value),
        isSystem: false,
        groupId: group.id
      }
    });
    res.status(201).json({
      data: { id: created.id, value: created.value, label: created.label, isSystem: created.isSystem }
    });
  } catch (err: any) {
    if ((err as any)?.code === "P2002") {
      return res.status(409).json({ error: "Tag value already exists in this group." });
    }
    console.error("[tags] create failed", err);
    res.status(500).json({ error: "Could not create tag." });
  }
});

router.patch("/tags/:id", requireRoles(["ADMIN"]), async (req, res) => {
  const parsed = tagUpdateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  const tag = await prisma.tag.findUnique({ where: { id: req.params.id }, include: { group: true } });
  if (!tag) return res.status(404).json({ error: "Tag not found." });
  if (!tag.group.editable || tag.isSystem) {
    return res.status(400).json({ error: "This tag cannot be edited." });
  }

  const updated = await prisma.tag.update({
    where: { id: tag.id },
    data: { label: parsed.data.label.trim() }
  });

  res.json({ data: { id: updated.id, value: updated.value, label: updated.label, isSystem: updated.isSystem } });
});

router.delete("/tags/:id", requireRoles(["ADMIN"]), async (req, res) => {
  const tag = await prisma.tag.findUnique({
    where: { id: req.params.id },
    include: { group: true, products: true }
  });
  if (!tag) return res.status(404).json({ error: "Tag not found." });
  if (!tag.group.editable || tag.isSystem) {
    return res.status(400).json({ error: "This tag cannot be deleted." });
  }
  if (tag.products.length > 0) {
    return res.status(400).json({ error: "Remove this tag from products before deleting it." });
  }

  await prisma.tag.delete({ where: { id: tag.id } });
  res.json({ ok: true });
});
