import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { requireRoles } from "../lib/authz.js";

export const router = Router();

// Sales summary: total revenue, orders, avg order value — last 30 days vs prior 30 days
router.get("/sales-summary", requireRoles(["ADMIN", "ACCOUNTS"]), async (_req, res) => {
  try {
    const now = new Date();
    const d30 = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const d60 = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);

    const [current, prior, allTime] = await Promise.all([
      prisma.salesOrder.findMany({
        where: { createdAt: { gte: d30 }, status: { not: "CANCELLED" } },
        select: { total: true, channel: true, paymentStatus: true },
      }),
      prisma.salesOrder.findMany({
        where: { createdAt: { gte: d60, lt: d30 }, status: { not: "CANCELLED" } },
        select: { total: true },
      }),
      prisma.salesOrder.aggregate({
        where: { status: { not: "CANCELLED" } },
        _sum: { total: true },
        _count: true,
      }),
    ]);

    const sumRevenue = (orders: { total: any }[]) =>
      orders.reduce((s, o) => s + Number(o.total), 0);

    const currRev = sumRevenue(current);
    const priorRev = sumRevenue(prior);
    const pctChange = priorRev === 0 ? null : ((currRev - priorRev) / priorRev) * 100;

    const onlineCount = current.filter((o) => o.channel === "ONLINE").length;
    const counterCount = current.filter((o) => o.channel === "COUNTER").length;

    res.json({
      data: {
        last30: {
          revenue: currRev,
          orders: current.length,
          avgOrder: current.length ? currRev / current.length : 0,
          onlineOrders: onlineCount,
          counterOrders: counterCount,
        },
        prior30: {
          revenue: priorRev,
          orders: prior.length,
        },
        pctChange,
        allTime: {
          revenue: Number(allTime._sum.total ?? 0),
          orders: allTime._count,
        },
      },
    });
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? "Failed to load sales summary" });
  }
});

// Daily revenue for the last N days (for chart)
router.get("/daily", requireRoles(["ADMIN", "ACCOUNTS"]), async (req, res) => {
  const days = Math.min(Number(req.query.days ?? 30), 90);
  try {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const orders = await prisma.salesOrder.findMany({
      where: { createdAt: { gte: since }, status: { not: "CANCELLED" } },
      select: { total: true, createdAt: true, channel: true },
      orderBy: { createdAt: "asc" },
    });

    const byDay: Record<string, { date: string; revenue: number; orders: number }> = {};
    for (let i = 0; i < days; i++) {
      const d = new Date(since.getTime() + i * 24 * 60 * 60 * 1000);
      const key = d.toISOString().slice(0, 10);
      byDay[key] = { date: key, revenue: 0, orders: 0 };
    }
    for (const o of orders) {
      const key = o.createdAt.toISOString().slice(0, 10);
      if (byDay[key]) {
        byDay[key].revenue += Number(o.total);
        byDay[key].orders += 1;
      }
    }

    res.json({ data: Object.values(byDay) });
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? "Failed to load daily data" });
  }
});

// Top-selling products by revenue
router.get("/top-products", requireRoles(["ADMIN", "ACCOUNTS"]), async (_req, res) => {
  try {
    const items = await prisma.salesOrderItem.groupBy({
      by: ["productId"],
      _sum: { qty: true },
      _count: true,
      orderBy: { _sum: { qty: "desc" } },
      take: 10,
    });

    const ids = items.map((i) => i.productId);
    const products = await prisma.product.findMany({
      where: { id: { in: ids } },
      select: { id: true, name: true, sku: true, price: true, imageUrl: true },
    });

    const result = items.map((i) => {
      const p = products.find((p) => p.id === i.productId);
      return {
        productId: i.productId,
        name: p?.name ?? "Unknown",
        sku: p?.sku ?? "—",
        qtySold: i._sum.qty ?? 0,
        revenue: (i._sum.qty ?? 0) * Number(p?.price ?? 0),
      };
    });

    res.json({ data: result });
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? "Failed to load top products" });
  }
});
