import { Router } from "express";
import { z } from "zod";
import prisma from "../lib/prisma.js";
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
