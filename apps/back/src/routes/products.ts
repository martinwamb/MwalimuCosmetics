import { Router } from "express";
import { z } from "zod";

const productSchema = z.object({
  id: z.string(),
  name: z.string(),
  price: z.number(),
  description: z.string().optional(),
  stockQty: z.number().int()
});

const mockProducts = [
  { id: "p-1", name: "Shea Body Butter", price: 15.5, description: "Rich moisturizer", stockQty: 120 },
  { id: "p-2", name: "Vitamin C Serum", price: 25.0, description: "Brightening serum", stockQty: 80 },
  { id: "p-3", name: "Matte Lipstick", price: 12.0, description: "Long wear color", stockQty: 200 }
];

export const router = Router();

router.get("/", (_req, res) => {
  res.json({ data: mockProducts });
});

router.post("/", (req, res) => {
  const parsed = productSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  const product = parsed.data;
  mockProducts.push(product);
  res.status(201).json({ data: product });
});
