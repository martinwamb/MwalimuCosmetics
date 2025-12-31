"use client";

import { useEffect, useState } from "react";

type OrderItem = {
  id: string;
  productId: string;
  qty: number;
  unitPrice: number;
};

type Order = {
  id: string;
  status?: string;
  paymentStatus?: string;
  total?: number;
  createdAt?: string;
  items?: OrderItem[];
};

const apiBase = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export default function OrdersPage() {
  const [token, setToken] = useState<string | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    try {
      const saved = typeof window !== "undefined" ? localStorage.getItem("mwalimu_token") : null;
      setToken(saved);
    } catch {
      setToken(null);
    }
  }, []);

  useEffect(() => {
    async function loadOrders() {
      if (!token) {
        setLoading(false);
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`${apiBase}/orders/mine`, {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store"
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error((data?.error as string) ?? "Unable to load orders");
        }
        setOrders((data?.data as Order[]) ?? []);
      } catch (err: any) {
        setError(err?.message ?? "Unable to load orders.");
      } finally {
        setLoading(false);
      }
    }

    loadOrders();
  }, [token]);

  function formatKES(value?: number | null) {
    if (typeof value !== "number") return "KES 0.00";
    return new Intl.NumberFormat("en-KE", { style: "currency", currency: "KES", maximumFractionDigits: 2 }).format(value);
  }

  if (!token) {
    return (
      <div className="card">
        <h2 style={{ marginTop: 0 }}>Your orders</h2>
        <p className="muted">
          Sign in to see past orders, delivery statuses, and quick reorders. The top bar keeps Home, language, sign in,
          orders, and cart in view.
        </p>
        <a href="/sign-in" className="text-link" style={{ marginTop: "0.5rem", display: "inline-block" }}>
          Go to sign in
        </a>
      </div>
    );
  }

  return (
    <div className="card">
      <h2 style={{ marginTop: 0 }}>Your orders</h2>
      {loading && <p className="muted">Loading orders...</p>}
      {error && <div className="signin-error">{error}</div>}
      {!loading && !orders.length && (
        <p className="muted">No orders linked to this account yet. Place an order and it will appear here.</p>
      )}
      {!loading && orders.length > 0 && (
        <div style={{ display: "grid", gap: "0.75rem" }}>
          {orders.map((order) => (
            <article key={order.id} className="card" style={{ padding: "0.9rem" }}>
              <div className="hero-eyebrow" style={{ marginBottom: "0.25rem" }}>
                Order {order.id}
              </div>
              <p className="muted small" style={{ margin: 0 }}>
                Status: {order.status ?? "PENDING"} • Payment: {order.paymentStatus ?? "UNPAID"}
              </p>
              <p className="price" style={{ marginTop: "0.35rem" }}>
                {formatKES(order.total ?? 0)}
              </p>
              {order.items?.length ? (
                <ul style={{ listStyle: "none", padding: 0, margin: "0.5rem 0 0", display: "grid", gap: "0.25rem" }}>
                  {order.items.map((item) => (
                    <li key={item.id} className="muted small">
                      {item.qty} × {item.productId} • {formatKES(item.unitPrice)}
                    </li>
                  ))}
                </ul>
              ) : null}
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
