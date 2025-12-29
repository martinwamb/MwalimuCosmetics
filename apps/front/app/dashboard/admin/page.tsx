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

type StaffUser = {
  id: string;
  email: string;
  role: string;
};

const apiBase = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export default function AdminDashboardPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [staff, setStaff] = useState<StaffUser[]>([]);
  const [tab, setTab] = useState<"products" | "reports" | "users">("products");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [staffForm, setStaffForm] = useState({ email: "", password: "", role: "ADMIN" });
  const [staffStatus, setStaffStatus] = useState<string | null>(null);

  useEffect(() => {
    try {
      const saved = typeof window !== "undefined" ? localStorage.getItem("mwalimu_token") : null;
      if (saved) setToken(saved);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    async function load() {
      if (!token) {
        setError("Sign in as admin to view the workspace.");
        setLoading(false);
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const headers: Record<string, string> = {};
        headers.Authorization = `Bearer ${token}`;
        const [productsRes, ordersRes, staffRes] = await Promise.all([
          fetch(`${apiBase}/products?status=ACTIVE&take=200`, { cache: "no-store" }),
          fetch(`${apiBase}/orders`, { cache: "no-store" }),
          fetch(`${apiBase}/auth/staff`, { headers })
        ]);
        const productsJson = await productsRes.json().catch(() => ({}));
        const ordersJson = await ordersRes.json().catch(() => ({}));
        const staffJson = await staffRes.json().catch(() => ({}));
        if (!productsRes.ok) throw new Error((productsJson?.error as string) ?? "Could not load products");
        if (!ordersRes.ok) throw new Error((ordersJson?.error as string) ?? "Could not load orders");
        if (!staffRes.ok) throw new Error((staffJson?.error as string) ?? "Could not load users");

        setProducts((productsJson?.data as Product[]) ?? []);
        setOrders((ordersJson?.data as Order[]) ?? []);
        setStaff((staffJson?.data as StaffUser[]) ?? []);
      } catch (err: any) {
        setError(err?.message ?? "Unable to load admin data.");
      } finally {
        setLoading(false);
      }
    }

    load();
  }, [token]);

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

  async function handleCreateStaff(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStaffStatus(null);
    setError(null);
    if (!token) {
      setError("Sign in as admin to add users.");
      return;
    }
    try {
      const res = await fetch(`${apiBase}/auth/staff`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify(staffForm)
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data?.error as string) ?? "Could not add user");
      setStaffStatus("User added.");
      setStaffForm({ email: "", password: "", role: "ADMIN" });
      // refresh staff list
      const staffRes = await fetch(`${apiBase}/auth/staff`, { headers: { Authorization: `Bearer ${token}` } });
      const staffJson = await staffRes.json().catch(() => ({}));
      if (staffRes.ok) setStaff((staffJson?.data as StaffUser[]) ?? []);
    } catch (err: any) {
      setError(err?.message ?? "Could not add user.");
    }
  }

  return (
    <div className="card">
      <div className="hero-eyebrow" style={{ marginBottom: "0.3rem" }}>
        Admin workspace
      </div>
      <h1 style={{ margin: 0 }}>Catalog, reports, and users</h1>
      <p className="muted" style={{ marginTop: "0.35rem" }}>
        Manage products, view reports, and add staff emails that can sign in.
      </p>

      <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.75rem", flexWrap: "wrap" }}>
        <button className={`button ${tab === "products" ? "" : "ghost"}`} onClick={() => setTab("products")}>
          Products
        </button>
        <button className={`button ${tab === "reports" ? "" : "ghost"}`} onClick={() => setTab("reports")}>
          Reports
        </button>
        <button className={`button ${tab === "users" ? "" : "ghost"}`} onClick={() => setTab("users")}>
          Users
        </button>
      </div>

      {loading && <p className="muted" style={{ marginTop: "0.75rem" }}>Loading workspace data...</p>}
      {error && <div className="signin-error" style={{ marginTop: "0.5rem" }}>{error}</div>}
      {staffStatus && <div className="signin-success" style={{ marginTop: "0.5rem" }}>{staffStatus}</div>}

      {tab === "products" && (
        <div style={{ marginTop: "1rem", display: "grid", gridTemplateColumns: "1fr", gap: "1rem" }}>
          <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "0.75rem" }}>
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
                Low stock
              </div>
              <h3 style={{ margin: "0 0 0.15rem" }}>{stats.lowStock}</h3>
              <p className="muted small" style={{ margin: 0 }}>
                Under 10 units remaining
              </p>
            </article>
          </div>
          <div className="hero-actions" style={{ gap: "0.5rem", flexWrap: "wrap", display: "flex" }}>
            <a className="button" href="/dashboard/products">
              Add / manage products
            </a>
            <a className="button ghost" href="/orders">
              View orders
            </a>
            <a className="button ghost" href="/dashboard/homepage">
              Homepage layout
            </a>
            <a className="button ghost" href="/dashboard/tags">
              Manage tags
            </a>
          </div>
          <div>
            <div className="hero-eyebrow" style={{ marginBottom: "0.35rem" }}>
              Recent products
            </div>
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
                    <p className="price">KES {product.price ? product.price.toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "0.00"}</p>
                  </article>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {tab === "reports" && (
        <div style={{ marginTop: "1rem" }}>
          <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "0.75rem" }}>
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
              <h3 style={{ margin: "0 0 0.15rem" }}>
                KES {stats.revenue.toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </h3>
              <p className="muted small" style={{ margin: 0 }}>
                Based on current order data
              </p>
            </article>
          </div>
          <ul style={{ listStyle: "none", padding: 0, margin: "1rem 0 0", display: "grid", gap: "0.5rem" }}>
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
        </div>
      )}

      {tab === "users" && (
        <div style={{ marginTop: "1rem", display: "grid", gap: "1rem", gridTemplateColumns: "1fr 1fr" }}>
          <section className="card">
            <div className="hero-eyebrow" style={{ marginBottom: "0.35rem" }}>
              Add staff user
            </div>
            <form className="signin-form" onSubmit={handleCreateStaff}>
              <label className="input-group">
                <span>Email</span>
                <input
                  type="email"
                  value={staffForm.email}
                  onChange={(e) => setStaffForm((prev) => ({ ...prev, email: e.target.value }))}
                  required
                />
              </label>
              <label className="input-group">
                <span>Password</span>
                <input
                  type="password"
                  value={staffForm.password}
                  onChange={(e) => setStaffForm((prev) => ({ ...prev, password: e.target.value }))}
                  required
                />
              </label>
              <label className="input-group">
                <span>Role</span>
                <select value={staffForm.role} onChange={(e) => setStaffForm((prev) => ({ ...prev, role: e.target.value }))}>
                  <option value="ADMIN">Admin</option>
                  <option value="ACCOUNTS">Accounts</option>
                  <option value="SALES">Sales</option>
                </select>
              </label>
              <button className="button" type="submit">
                Add user
              </button>
            </form>
          </section>
          <section className="card">
            <div className="hero-eyebrow" style={{ marginBottom: "0.35rem" }}>
              Staff with access
            </div>
            {!staff.length && <p className="muted">No staff listed yet.</p>}
            {staff.length > 0 && (
              <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: "0.5rem" }}>
                {staff.map((user) => (
                  <li key={user.id} className="card" style={{ padding: "0.75rem" }}>
                    <strong>{user.email}</strong>
                    <p className="muted small" style={{ margin: "0.25rem 0 0" }}>
                      {user.role}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
