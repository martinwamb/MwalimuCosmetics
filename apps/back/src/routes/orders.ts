import { Router } from "express";
import { z } from "zod";

const orderSchema = z.object({
  id: z.string().optional(),
  channel: z.enum(["ONLINE", "COUNTER"]),
  items: z.array(
    z.object({
      productId: z.string(),
      qty: z.number().int().positive(),
      unitPrice: z.number()
    })
  ),
  paymentMethod: z.enum(["CARD", "CASH", "MOBILE_MONEY", "BANK_TRANSFER"]).optional()
});

const mockOrders: any[] = [];

export const router = Router();

router.get("/", (_req, res) => {
  res.json({ data: mockOrders });
});

router.post("/", (req, res) => {
  const parsed = orderSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  const order = {
    id: `o-${mockOrders.length + 1}`,
    ...parsed.data,
    paymentStatus: parsed.data.paymentMethod ? "PAID" : "UNPAID"
  };
  mockOrders.push(order);
  res.status(201).json({ data: order });
});
