"use client";

import { useCallback, useEffect, useState } from "react";

const apiBase = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

type Order = {
  id: string;
  channel: "ONLINE" | "COUNTER";
  status: string;
  paymentStatus: string;
  paymentMethod: string | null;
  total: number;
  createdAt: string;
  customer?: { name: string; email?: string | null; phone?: string | null } | null;
  items: { qty: number; unitPrice: number; product?: { name: string } | null }[];
};

function fmt(n: number) {
  return new Intl.NumberFormat("en-KE", { style: "currency", currency: "KES", maximumFractionDigits: 0 }).format(n);
}

function statusChip(status: string) {
  const map: Record<string, string> = {
    PENDING: "chip chip-yellow",
    PAID: "chip chip-blue",
    FULFILLED: "chip chip-green",
    CANCELLED: "chip chip-red",
  };
  return <span className={map[status] ?? "chip chip-gray"}>{status}</span>;
}

function payChip(ps: string) {
  const map: Record<string, string> = { UNPAID: "chip chip-red", PARTIAL: "chip chip-yellow", PAID: "chip chip-green" };
  return <span className={map[ps] ?? "chip chip-gray"}>{ps}</span>;
}

export default function OrdersPage() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<"ALL" | "ONLINE" | "COUNTER">("ALL");
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [acting, setActing] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = useCallback(async () => {
    const token = localStorage.getItem("mwalimu_token");
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${apiBase}/orders`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error ?? "Failed to load orders");
      setOrders(data.data ?? []);
    } catch (err: any) {
      setError(err?.message ?? "Failed to load orders");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function cancelOrder(id: string) {
    const token = localStorage.getItem("mwalimu_token");
    if (!token) return;
    setActing(id);
    try {
      const res = await fetch(`${apiBase}/orders/${id}/cancel`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d?.error ?? "Cancel failed");
      }
      await load();
    } catch (err: any) {
      alert(err?.message ?? "Cancel failed");
    } finally {
      setActing(null);
    }
  }

  const displayed = orders.filter((o) => {
    if (filter !== "ALL" && o.channel !== filter) return false;
    if (statusFilter !== "ALL" && o.status !== statusFilter) return false;
    return true;
  });

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "1rem", flexWrap: "wrap", gap: "0.75rem" }}>
        <h1 style={{ margin: 0, fontSize: "1.35rem", fontWeight: 800, letterSpacing: "-0.02em" }}>Orders</h1>
        <button className="button ghost" onClick={load} style={{ fontSize: "0.85rem" }}>↻ Refresh</button>
      </div>

      <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginBottom: "1rem" }}>
        {["ALL", "ONLINE", "COUNTER"].map((c) => (
          <button
            key={c}
            className={`filter-chip ${filter === c ? "active" : ""}`}
            onClick={() => setFilter(c as any)}
          >
            {c === "ALL" ? "All channels" : c}
          </button>
        ))}
        <span style={{ borderLeft: "1px solid var(--border)", margin: "0 0.25rem" }} />
        {["ALL", "PENDING", "PAID", "FULFILLED", "CANCELLED"].map((s) => (
          <button
            key={s}
            className={`filter-chip ${statusFilter === s ? "active" : ""}`}
            onClick={() => setStatusFilter(s)}
          >
            {s === "ALL" ? "All statuses" : s}
          </button>
        ))}
      </div>

      {error && <div className="signin-error" style={{ marginBottom: "1rem" }}>{error}</div>}

      {loading ? (
        <div style={{ textAlign: "center", padding: "3rem", color: "var(--muted)" }}>Loading orders…</div>
      ) : (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Order ID</th>
                <th>Date</th>
                <th>Channel</th>
                <th>Customer</th>
                <th>Total</th>
                <th>Payment</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {displayed.length === 0 && (
                <tr>
                  <td colSpan={8} style={{ textAlign: "center", color: "var(--muted)", padding: "2rem" }}>No orders found.</td>
                </tr>
              )}
              {displayed.map((order) => (
                <>
                  <tr key={order.id} style={{ cursor: "pointer" }} onClick={() => setExpanded(expanded === order.id ? null : order.id)}>
                    <td style={{ fontWeight: 700, fontFamily: "monospace", fontSize: "0.85rem" }}>{order.id}</td>
                    <td style={{ color: "var(--muted)", fontSize: "0.85rem" }}>
                      {new Date(order.createdAt).toLocaleDateString("en-KE", { day: "numeric", month: "short", year: "numeric" })}
                    </td>
                    <td>
                      <span className={`chip ${order.channel === "ONLINE" ? "chip-blue" : "chip-gray"}`}>{order.channel}</span>
                    </td>
                    <td style={{ fontSize: "0.88rem" }}>
                      {order.customer?.name ?? <span style={{ color: "var(--muted)" }}>Guest</span>}
                      {order.customer?.phone && <div style={{ color: "var(--muted)", fontSize: "0.78rem" }}>{order.customer.phone}</div>}
                    </td>
                    <td style={{ fontWeight: 700 }}>{fmt(Number(order.total))}</td>
                    <td>
                      <div>{payChip(order.paymentStatus)}</div>
                      {order.paymentMethod && <div style={{ fontSize: "0.78rem", color: "var(--muted)", marginTop: "0.2rem" }}>{order.paymentMethod.replace(/_/g, " ")}</div>}
                    </td>
                    <td>{statusChip(order.status)}</td>
                    <td>
                      <div style={{ display: "flex", gap: "0.35rem", flexWrap: "wrap" }}>
                        {order.status !== "CANCELLED" && order.status !== "FULFILLED" && (
                          <button
                            className="button ghost"
                            style={{ padding: "0.3rem 0.6rem", fontSize: "0.8rem", color: "#dc2626" }}
                            onClick={(e) => { e.stopPropagation(); cancelOrder(order.id); }}
                            disabled={acting === order.id}
                          >
                            {acting === order.id ? "…" : "Cancel"}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                  {expanded === order.id && (
                    <tr key={`${order.id}-detail`}>
                      <td colSpan={8} style={{ background: "#f8fafc", padding: "0.75rem 1rem" }}>
                        <div style={{ fontWeight: 700, marginBottom: "0.4rem", fontSize: "0.85rem" }}>Line items</div>
                        {order.items.map((item, i) => (
                          <div key={i} style={{ display: "flex", justifyContent: "space-between", fontSize: "0.85rem", padding: "0.25rem 0", borderBottom: "1px solid var(--border)" }}>
                            <span>{item.product?.name ?? "Product"} × {item.qty}</span>
                            <span style={{ fontWeight: 700 }}>{fmt(Number(item.unitPrice) * item.qty)}</span>
                          </div>
                        ))}
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
