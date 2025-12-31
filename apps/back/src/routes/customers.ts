import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { requireRoles } from "../lib/authz.js";

export const router = Router();

function csvValue(value: any) {
  if (value === null || value === undefined) return "";
  const str = String(value).replace(/"/g, '""');
  return `"${str}"`;
}

router.get("/", requireRoles(["ADMIN", "ACCOUNTS", "SALES"]), async (req, res) => {
  const marketingOptIn = req.query.marketingOptIn as string | undefined;
  const format = (req.query.format as string | undefined) ?? "json";
  const where =
    typeof marketingOptIn === "string"
      ? { marketingOptIn: marketingOptIn === "true" }
      : undefined;

  try {
    const customers = await prisma.customer.findMany({
      where,
      orderBy: { createdAt: "desc" },
      include: {
        orders: {
          select: { id: true, createdAt: true, total: true }
        }
      }
    });

    const shaped = customers.map((customer) => {
      const orderCount = customer.orders.length;
      const lastOrderAt = customer.orders.reduce<Date | null>((latest, order) => {
        if (!latest || order.createdAt > latest) return order.createdAt;
        return latest;
      }, null);
      return {
        id: customer.id,
        name: customer.name,
        email: customer.email,
        phone: customer.phone,
        address: customer.address,
        marketingOptIn: customer.marketingOptIn,
        orderCount,
        lastOrderAt,
        createdAt: customer.createdAt
      };
    });

    if (format === "csv") {
      const headers = ["name", "email", "phone", "address", "marketingOptIn", "orderCount", "lastOrderAt", "createdAt"];
      const lines = [headers.join(",")].concat(
        shaped.map((row) =>
          [
            csvValue(row.name),
            csvValue(row.email),
            csvValue(row.phone),
            csvValue(row.address),
            csvValue(row.marketingOptIn),
            csvValue(row.orderCount),
            csvValue(row.lastOrderAt ? row.lastOrderAt.toISOString() : ""),
            csvValue(row.createdAt.toISOString())
          ].join(",")
        )
      );
      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", "attachment; filename=\"customers.csv\"");
      return res.send(lines.join("\n"));
    }

    return res.json({ data: shaped });
  } catch (err: any) {
    console.error("[customers] list failed", err?.message ?? err);
    return res.status(500).json({ error: "Unable to load customers" });
  }
});
