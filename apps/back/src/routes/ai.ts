import { Router } from "express";
import { z } from "zod";

const priceAlertSchema = z.object({
  productId: z.string(),
  marketPrice: z.number(),
  ourPrice: z.number(),
  source: z.string()
});

const slowMoverSchema = z.object({
  productId: z.string(),
  daysWithoutSale: z.number().int(),
  suggestedDiscountPercent: z.number()
});

const seasonalSchema = z.object({
  productId: z.string(),
  month: z.number().int(),
  recommendedQty: z.number().int()
});

const aiAlerts: any[] = [];

export const router = Router();

router.get("/alerts", (_req, res) => {
  res.json({ data: aiAlerts });
});

router.post("/price-gap", (req, res) => {
  const parsed = priceAlertSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  const alert = { type: "PRICE_GAP", ...parsed.data };
  aiAlerts.push(alert);
  res.status(201).json({ data: alert });
});

router.post("/slow-mover", (req, res) => {
  const parsed = slowMoverSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  const alert = { type: "SLOW_MOVER_DISCOUNT", ...parsed.data };
  aiAlerts.push(alert);
  res.status(201).json({ data: alert });
});

router.post("/seasonal", (req, res) => {
  const parsed = seasonalSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  const alert = { type: "SEASONAL_STOCK", ...parsed.data };
  aiAlerts.push(alert);
  res.status(201).json({ data: alert });
});
