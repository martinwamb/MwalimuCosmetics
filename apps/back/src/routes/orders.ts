import { Router } from "express";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { sendAppMail } from "../lib/mailer.js";
import { prisma } from "../lib/prisma.js";

const ORDER_EMAIL = process.env.ORDER_EMAIL ?? process.env.MAIL_FROM;
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const WHATSAPP_PHONE_ID = process.env.WHATSAPP_PHONE_ID;
const WHATSAPP_TO = process.env.ORDER_WHATSAPP_TO;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

const orderSchema = z.object({
  id: z.string().optional(),
  channel: z.enum(["ONLINE", "COUNTER"]),
  items: z.array(
    z.object({
      productId: z.string(),
      name: z.string().optional(),
      qty: z.number().int().positive(),
      unitPrice: z.number()
    })
  ),
  paymentMethod: z.enum(["CARD", "CASH", "MOBILE_MONEY", "BANK_TRANSFER"]).optional(),
  customer: z
    .object({
      name: z.string().min(1, "Name is required").optional(),
      email: z.string().email().optional(),
      phone: z.string().optional(),
      address: z.string().optional(),
      marketingOptIn: z.boolean().optional()
    })
    .optional()
});

export const router = Router();

router.get("/", async (_req, res) => {
  try {
    const orders = await prisma.salesOrder.findMany({
      orderBy: { createdAt: "desc" },
      include: { items: true, customer: true }
    });
    res.json({ data: orders });
  } catch (err: any) {
    console.error("[orders] list failed", err?.message ?? err);
    res.status(500).json({ error: "Unable to load orders" });
  }
});

router.post("/", async (req, res) => {
  const parsed = orderSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  const subtotal = parsed.data.items.reduce((sum, item) => sum + item.unitPrice * item.qty, 0);

  let persistedOrder: Awaited<ReturnType<typeof prisma.salesOrder.create>> | null = null;
  try {
    persistedOrder = await prisma.$transaction(async (tx) => {
      let customerId: string | null = null;
      if (parsed.data.customer && (parsed.data.customer.email || parsed.data.customer.phone || parsed.data.customer.name)) {
        const contactWhere = parsed.data.customer.email
          ? { email: parsed.data.customer.email }
          : parsed.data.customer.phone
            ? { phone: parsed.data.customer.phone }
            : null;
        const existing = contactWhere ? await tx.customer.findFirst({ where: contactWhere }) : null;
        const customer = existing
          ? await tx.customer.update({
              where: { id: existing.id },
              data: {
                name: parsed.data.customer.name ?? existing.name,
                address: parsed.data.customer.address ?? existing.address,
                marketingOptIn: parsed.data.customer.marketingOptIn ?? existing.marketingOptIn
              }
            })
          : await tx.customer.create({
              data: {
                name: parsed.data.customer.name ?? "Guest",
                email: parsed.data.customer.email,
                phone: parsed.data.customer.phone,
                address: parsed.data.customer.address,
                marketingOptIn: parsed.data.customer.marketingOptIn ?? false
              }
            });
        customerId = customer.id;
      }

      const order = await tx.salesOrder.create({
        data: {
          channel: parsed.data.channel,
          paymentMethod: parsed.data.paymentMethod ?? null,
          paymentStatus: parsed.data.paymentMethod ? "PAID" : "UNPAID",
          subtotal: new Prisma.Decimal(subtotal),
          tax: new Prisma.Decimal(0),
          discount: new Prisma.Decimal(0),
          total: new Prisma.Decimal(subtotal),
          customerId,
          items: {
            create: parsed.data.items.map((item) => ({
              productId: item.productId,
              qty: item.qty,
              unitPrice: new Prisma.Decimal(item.unitPrice)
            }))
          }
        },
        include: { items: true, customer: true }
      });

      return order;
    });
  } catch (err: any) {
    console.error("[orders] persistence failed", err?.message ?? err);
    return res.status(400).json({ error: err?.message ?? "Unable to save order" });
  }

  const summary = buildOrderSummary({
    id: persistedOrder.id,
    channel: persistedOrder.channel,
    paymentMethod: persistedOrder.paymentMethod,
    customer: parsed.data.customer,
    items: parsed.data.items,
    subtotal
  });

  try {
    await Promise.allSettled([
      sendOrderEmail(summary),
      sendOrderWhatsApp(summary),
      sendOrderTelegram(summary)
    ]);
  } catch (err: any) {
    console.error("[orders] Failed to dispatch all notifications", err?.message ?? err);
  }

  res.status(201).json({ data: persistedOrder });
});

function buildOrderSummary(order: {
  id: string;
  channel: string;
  paymentMethod?: string | null;
  customer?: {
    name?: string;
    email?: string;
    phone?: string;
    address?: string;
    marketingOptIn?: boolean;
  };
  items: { productId: string; name?: string | null; qty: number; unitPrice: number }[];
  subtotal: number;
}) {
  const items = order.items
    .map(
      (item: any, idx: number) =>
        `${idx + 1}. ${item.name ?? item.productId} x${item.qty} @ ${formatCurrency(item.unitPrice)} = ${formatCurrency(
          item.unitPrice * item.qty
        )}`
    )
    .join("\n");

  const customerLines = order.customer
    ? [
        order.customer.name ? `Name: ${order.customer.name}` : null,
        order.customer.email ? `Email: ${order.customer.email}` : null,
        order.customer.phone ? `Phone: ${order.customer.phone}` : null,
        order.customer.address ? `Address: ${order.customer.address}` : null,
        typeof order.customer.marketingOptIn === "boolean"
          ? `Marketing opt-in: ${order.customer.marketingOptIn ? "Yes" : "No"}`
          : null
      ].filter(Boolean)
    : [];

  return {
    subject: `New order ${order.id} via ${order.channel}`,
    text: `New order ${order.id} via ${order.channel}\n\nItems:\n${items}\n\nSubtotal: ${formatCurrency(
      order.subtotal
    )}\nPayment: ${order.paymentMethod ?? "Unpaid"}\n${customerLines.length ? "\nCustomer:\n" + customerLines.join("\n") : ""}`
  };
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat("en-KE", { style: "currency", currency: "KES" }).format(value);
}

async function sendOrderEmail(summary: { subject: string; text: string }) {
  if (!ORDER_EMAIL) {
    console.warn("[orders] ORDER_EMAIL not set. Skipping email send.");
    return;
  }
  await sendAppMail({
    to: ORDER_EMAIL,
    subject: summary.subject,
    text: summary.text
  });
}

async function sendOrderWhatsApp(summary: { text: string }) {
  if (!WHATSAPP_TOKEN || !WHATSAPP_PHONE_ID || !WHATSAPP_TO) {
    console.warn("[orders] WhatsApp credentials missing. Skipping WhatsApp send.");
    return;
  }

  const url = `https://graph.facebook.com/v18.0/${WHATSAPP_PHONE_ID}/messages`;
  const payload = {
    messaging_product: "whatsapp",
    to: WHATSAPP_TO.replace(/[^\d]/g, ""),
    type: "text",
    text: { preview_url: false, body: summary.text }
  };

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${WHATSAPP_TOKEN}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  if (!res.ok) {
    const body = await res.text();
    console.error("[orders] WhatsApp send failed", res.status, body);
    throw new Error("WhatsApp send failed");
  }
}

async function sendOrderTelegram(summary: { text: string }) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    console.warn("[orders] Telegram credentials missing. Skipping Telegram send.");
    return;
  }

  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text: summary.text })
  });

  if (!res.ok) {
    const body = await res.text();
    console.error("[orders] Telegram send failed", res.status, body);
    throw new Error("Telegram send failed");
  }
}
