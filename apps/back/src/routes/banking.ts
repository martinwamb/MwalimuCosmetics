import { Router } from "express";
import { z } from "zod";

const statementSchema = z.object({
  id: z.string(),
  description: z.string(),
  amount: z.number(),
  txnDate: z.string()
});

const statements: any[] = [];
const reconciliations: any[] = [];

export const router = Router();

router.post("/statements", (req, res) => {
  const parsed = statementSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  statements.push(parsed.data);
  res.status(201).json({ data: parsed.data });
});

router.get("/statements", (_req, res) => {
  res.json({ data: statements });
});

router.post("/reconcile", (req, res) => {
  const schema = z.object({
    statementId: z.string(),
    paymentId: z.string(),
    status: z.enum(["MATCHED", "REVIEW", "UNMATCHED"])
  });

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  reconciliations.push({ id: `r-${reconciliations.length + 1}`, ...parsed.data });
  res.status(201).json({ data: reconciliations[reconciliations.length - 1] });
});
