"use client";

import { useEffect, useMemo, useState } from "react";

type Product = {
  id: string;
  name: string;
  status?: string;
  price?: number;
  stockQty?: number;
  category?: string | null;
};

type Order = {
  id: string;
  status?: string;
  total?: number;
  paymentStatus?: string;
};

const apiBase = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export default function AdminDashboardPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const [productsRes, ordersRes] = await Promise.all([
          fetch(`${apiBase}/products?status=ACTIVE&take=200`, { cache: "no-store" }),
          fetch(`${apiBase}/orders`, { cache: "no-store" })
        ]);
        const productsJson = await productsRes.json().catch(() => ({}));
        const ordersJson = await ordersRes.json().catch(() => ({}));
        if (!productsRes.ok) throw new Error((productsJson?.error as string) ?? "Could not load products");
        if (!ordersRes.ok) throw new Error((ordersJson?.error as string) ?? "Could not load orders");

        setProducts((productsJson?.data as Product[]) ?? []);
        setOrders((ordersJson?.data as Order[]) ?? []);
      } catch (err: any) {
        setError(err?.message ?? "Unable to load admin data.");
      } finally {
        setLoading(false);
      }
    }

    load();
  }, []);

  const stats = useMemo(() => {
    const totalProducts = products.length;
    const activeProducts = products.filter((p) => p.status !== "INACTIVE").length;
    const lowStock = products.filter((p) => typeof p.stockQty === "number" && (p.stockQty ?? 0) < 10).length;

    const totalOrders = orders.length;
    const paidOrders = orders.filter((o) => o.paymentStatus === "PAID").length;
    const pendingOrders = orders.filter((o) => o.status === "PENDING").length;
    const revenue = orders.reduce((sum, order) => sum + (Number(order.total) || 0), 0);

    return { totalProducts, activeProducts, lowStock, totalOrders, paidOrders, pendingOrders, revenue };
  }, [products, orders]);

  return (
    <div className="grid" style={{ gridTemplateColumns: "1.2fr 1fr", gap: "1.5rem" }}>
      <section className="card">
        <div className="hero-eyebrow" style={{ marginBottom: "0.3rem" }}>
          Admin workspace
        </div>
        <h1 style={{ margin: 0 }}>Catalog, orders, and reports</h1>
        <p className="muted" style={{ marginTop: "0.35rem" }}>
          Track products, orders, and operational metrics. Use quick links to add products, review mail, or open reports.
        </p>

        {loading && <p className="muted">Loading workspace data...</p>}
        {error && <div className="signin-error" style={{ marginTop: "0.5rem" }}>{error}</div>}

        {!loading && !error && (
          <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "0.75rem", marginTop: "1rem" }}>
            <article className="card" style={{ padding: "0.9rem" }}>
              <div className="hero-eyebrow" style={{ marginBottom: "0.15rem" }}>
                Products
              </div>
              <h3 style={{ margin: "0 0 0.15rem" }}>{stats.totalProducts}</h3>
              <p className="muted small" style={{ margin: 0 }}>
                {stats.activeProducts} active • {stats.lowStock} low stock
              </p>
            </article>
            <article className="card" style={{ padding: "0.9rem" }}>
              <div className="hero-eyebrow" style={{ marginBottom: "0.15rem" }}>
                Orders
              </div>
              <h3 style={{ margin: "0 0 0.15rem" }}>{stats.totalOrders}</h3>
              <p className="muted small" style={{ margin: 0 }}>
                {stats.pendingOrders} pending • {stats.paidOrders} paid
              </p>
            </article>
            <article className="card" style={{ padding: "0.9rem" }}>
              <div className="hero-eyebrow" style={{ marginBottom: "0.15rem" }}>
                Revenue (mock)
              </div>
              <h3 style={{ margin: "0 0 0.15rem" }}>USD {stats.revenue.toFixed(2)}</h3>
              <p className="muted small" style={{ margin: 0 }}>
                Based on current order data
              </p>
            </article>
          </div>
        )}

        <div className="hero-actions" style={{ marginTop: "1rem", display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
          <a className="button" href="/dashboard/products">
            Add / manage products
          </a>
          <a className="button ghost" href="/dashboard/mail">
            View platform mail
          </a>
          <a className="button ghost" href="/orders">
            View orders
          </a>
        </div>
      </section>

      <section className="card">
        <div className="hero-eyebrow" style={{ marginBottom: "0.25rem" }}>
          Reports & alerts
        </div>
        <h2 style={{ margin: "0 0 0.4rem" }}>What needs attention</h2>
        {loading && <p className="muted">Loading...</p>}
        {error && <p className="signin-error">{error}</p>}
        {!loading && !error && (
          <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: "0.5rem" }}>
            <li className="card" style={{ padding: "0.75rem" }}>
              <strong>Low stock</strong>
              <p className="muted" style={{ margin: "0.25rem 0 0" }}>
                {stats.lowStock > 0 ? `${stats.lowStock} products under 10 units` : "No low-stock items detected."}
              </p>
            </li>
            <li className="card" style={{ padding: "0.75rem" }}>
              <strong>Pending orders</strong>
              <p className="muted" style={{ margin: "0.25rem 0 0" }}>
                {stats.pendingOrders} pending orders. Review fulfillment status.
              </p>
            </li>
            <li className="card" style={{ padding: "0.75rem" }}>
              <strong>Product coverage</strong>
              <p className="muted" style={{ margin: "0.25rem 0 0" }}>
                {stats.activeProducts} active SKUs live. Add more categories or update imagery to improve coverage.
              </p>
            </li>
          </ul>
        )}
      </section>

      <section className="card" style={{ gridColumn: "span 2" }}>
        <div className="hero-eyebrow" style={{ marginBottom: "0.35rem" }}>
          Recent products
        </div>
        {loading && <p className="muted">Loading products...</p>}
        {!loading && products.length === 0 && <p className="muted">No products yet. Add your first item.</p>}
        {!loading && products.length > 0 && (
          <div className="catalog-grid">
            {products.slice(0, 8).map((product) => (
              <article key={product.id} className="product-card">
                <div className="badge">{product.category ?? "Uncategorized"}</div>
                <div className="product-thumb">{product.status ?? "ACTIVE"}</div>
                <h3 style={{ margin: "0.25rem 0 0" }}>{product.name}</h3>
                <p className="muted small" style={{ margin: 0 }}>
                  {product.status ?? "ACTIVE"} • Stock: {typeof product.stockQty === "number" ? product.stockQty : "—"}
                </p>
                <p className="price">USD {product.price ? product.price.toFixed(2) : "0.00"}</p>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
