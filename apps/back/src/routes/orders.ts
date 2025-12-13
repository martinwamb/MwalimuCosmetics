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
const STORE_BASE_URL = process.env.STORE_BASE_URL ?? "https://mwalimucosmetics.com/products";

const orderSchema = z.object({
  id: z.string().optional(),
  channel: z.enum(["ONLINE", "COUNTER"]),
  items: z.array(
    z.object({
      productId: z.string(),
      name: z.string().optional(),
      slug: z.string().optional(),
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
    persistedOrder = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const humanOrderId = `ORD-${Math.random().toString(36).slice(2, 6).toUpperCase()}-${Date.now().toString().slice(-4)}`;
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
          id: humanOrderId,
          channel: parsed.data.channel,
          paymentMethod: parsed.data.paymentMethod ?? null,
          paymentStatus: parsed.data.paymentMethod ? "PAID" : "UNPAID",
          subtotal: subtotal,
          tax: 0,
          discount: 0,
          total: subtotal,
          customerId,
          items: {
            create: parsed.data.items.map((item) => ({
              productId: item.productId,
              qty: item.qty,
              unitPrice: item.unitPrice
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

  const upsell = await fetchUpsellProducts(parsed.data.items.map((i) => i.productId));

  const summary = buildOrderSummary({
    id: persistedOrder.id,
    channel: persistedOrder.channel,
    paymentMethod: persistedOrder.paymentMethod,
    customer: parsed.data.customer,
    items: parsed.data.items,
    subtotal,
    upsell
  });

  try {
    await Promise.allSettled([
      sendOrderEmail(summary),
      sendCustomerEmail(summary, parsed.data.customer?.email),
      sendOrderWhatsApp(summary),
      sendOrderTelegram(summary)
    ]);
  } catch (err: any) {
    console.error("[orders] Failed to dispatch all notifications", err?.message ?? err);
  }

  res.status(201).json({ data: persistedOrder });
});

async function fetchUpsellProducts(productIds: string[]) {
  if (!productIds.length) return [];
  try {
    const products = await prisma.product.findMany({
      where: { id: { in: productIds } },
      include: { category: true }
    });
    const categoryIds = Array.from(
      new Set(
        products
          .map((p) => p.categoryId)
          .filter((id): id is string => Boolean(id))
      )
    );
    const candidates = await prisma.product.findMany({
      where: {
        status: { in: ["ACTIVE", "INACTIVE"] },
        id: { notIn: productIds },
        ...(categoryIds.length ? { categoryId: { in: categoryIds } } : {})
      },
      orderBy: { createdAt: "desc" },
      take: 5
    });
    return candidates.slice(0, 3).map((p) => ({
      id: p.id,
      slug: p.slug,
      name: p.name,
      price: parseFloat(p.price.toString()),
      imageUrl: p.imageUrl
    }));
  } catch (err: any) {
    console.error("[orders] upsell fetch failed", err?.message ?? err);
    return [];
  }
}

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
  items: { productId: string; slug?: string | null; name?: string | null; qty: number; unitPrice: number }[];
  subtotal: number;
  upsell?: { id: string; slug?: string | null; name: string; price: number; imageUrl?: string | null }[];
}) {
  const items = order.items
    .map((item: any, idx: number) => {
      const trimmedBase = STORE_BASE_URL ? STORE_BASE_URL.replace(/\/+$/, "") : null;
      const link = trimmedBase ? `${trimmedBase}/${item.slug ?? item.productId}` : null;
      const line = `${idx + 1}. ${item.name ?? item.productId} x${item.qty} @ ${formatCurrency(item.unitPrice)} = ${formatCurrency(
        item.unitPrice * item.qty
      )}`;
      return link ? `${line} (${link})` : line;
    })
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
      ].filter((line): line is string => Boolean(line))
    : [];

  return {
    subject: `New order ${order.id} via ${order.channel}`,
    text: `New order ${order.id} via ${order.channel}\n\nItems:\n${items}\n\nSubtotal: ${formatCurrency(
      order.subtotal
    )}\nPayment: ${order.paymentMethod ?? "Unpaid"}\n${customerLines.length ? "\nCustomer:\n" + customerLines.join("\n") : ""}${
      order.upsell?.length
        ? `\n\nYou may also like:\n${order.upsell
            .map((p) => {
              const base = STORE_BASE_URL ? STORE_BASE_URL.replace(/\/+$/, "") : null;
              const link = base ? `${base}/${p.slug ?? p.id}` : null;
              return link ? `- ${p.name} (${link})` : `- ${p.name}`;
            })
            .join("\n")}`
        : ""
    }`,
    html: buildHtmlSummary({ items, customerLines, order, upsell: order.upsell ?? [] })
  };
}

function buildHtmlSummary({
  items,
  customerLines,
  order,
  upsell
}: {
  items: string;
  customerLines: string[];
  order: any;
  upsell: { id: string; slug?: string | null; name: string; price: number; imageUrl?: string | null }[];
}) {
  const base = STORE_BASE_URL ? STORE_BASE_URL.replace(/\/+$/, "") : null;
  const upsellHtml = upsell
    .map((p) => {
      const link = base ? `${base}/${p.slug ?? p.id}` : "#";
      const img = p.imageUrl ? `<div style="margin-bottom:6px;"><img src="${p.imageUrl}" alt="${p.name}" width="120" style="border-radius:8px;border:1px solid #eee;"/></div>` : "";
      return `<td style="width:180px;padding:8px;vertical-align:top;border:1px solid #eee;border-radius:8px;">
        ${img}
        <div style="font-weight:600;margin-bottom:4px;">${p.name}</div>
        <div style="color:#555;font-size:13px;">${formatCurrency(p.price)}</div>
        <div style="margin-top:6px;">
          <a href="${link}" style="color:#0b5ed7;text-decoration:none;">View</a>
        </div>
      </td>`;
    })
    .join("");

  const customerHtml = customerLines.length
    ? `<p style="margin:0 0 8px 0;font-weight:600;">Customer</p><p style="margin:0 0 12px 0;color:#444;font-size:14px;">${customerLines.join("<br/>")}</p>`
    : "";

  return `
  <div style="font-family:Arial, sans-serif;color:#222;line-height:1.5;">
    <p style="margin:0 0 12px 0;">New order <strong>${order.id}</strong> via <strong>${order.channel}</strong></p>
    <p style="margin:0 0 8px 0;font-weight:600;">Items</p>
    <pre style="background:#f7f7f7;padding:10px;border-radius:8px;border:1px solid #eee;font-size:14px;margin:0 0 12px 0;">${items}</pre>
    <p style="margin:0 0 6px 0;">Subtotal: <strong>${formatCurrency(order.subtotal)}</strong></p>
    <p style="margin:0 0 12px 0;">Payment: <strong>${order.paymentMethod ?? "Unpaid"}</strong></p>
    ${customerHtml}
    ${
      upsellHtml
        ? `<p style="margin:16px 0 8px 0;font-weight:600;">You may also like</p>
           <table cellpadding="0" cellspacing="0" style="border-collapse:separate;border-spacing:8px 8px;"><tr>${upsellHtml}</tr></table>`
        : ""
    }
  </div>
  `;
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat("en-KE", { style: "currency", currency: "KES" }).format(value);
}

async function sendOrderEmail(summary: { subject: string; text: string; html?: string }) {
  if (!ORDER_EMAIL) {
    console.warn("[orders] ORDER_EMAIL not set. Skipping email send.");
    return;
  }
  await sendAppMail({
    to: ORDER_EMAIL,
    subject: summary.subject,
    text: summary.text,
    html: summary.html
  });
}

async function sendCustomerEmail(summary: { subject: string; text: string; html?: string }, customerEmail?: string | null) {
  if (!customerEmail) return;
  try {
    await sendAppMail({
      to: customerEmail,
      subject: summary.subject,
      text: summary.text,
      html: summary.html
    });
  } catch (err: any) {
    console.error("[orders] Failed to notify customer", err?.message ?? err);
  }
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
