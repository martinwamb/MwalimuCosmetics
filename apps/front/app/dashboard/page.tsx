"use client";

import { useEffect, useState } from "react";

const apiBase = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

type Summary = {
  last30: { revenue: number; orders: number; avgOrder: number; onlineOrders: number; counterOrders: number };
  prior30: { revenue: number; orders: number };
  pctChange: number | null;
  allTime: { revenue: number; orders: number };
};

type TopProduct = { productId: string; name: string; sku: string; qtySold: number; revenue: number };

function fmt(n: number) {
  return new Intl.NumberFormat("en-KE", { style: "currency", currency: "KES", maximumFractionDigits: 0 }).format(n);
}

function pctLabel(v: number | null) {
  if (v === null) return null;
  const sign = v >= 0 ? "+" : "";
  return `${sign}${v.toFixed(1)}% vs prior 30d`;
}

export default function DashboardHome() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [topProducts, setTopProducts] = useState<TopProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const token = localStorage.getItem("mwalimu_token");
    if (!token) return;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const headers = { Authorization: `Bearer ${token}` };
        const [sumRes, topRes] = await Promise.all([
          fetch(`${apiBase}/reports/sales-summary`, { headers, cache: "no-store" }),
          fetch(`${apiBase}/reports/top-products`, { headers, cache: "no-store" }),
        ]);

        if (sumRes.ok) {
          const d = await sumRes.json();
          setSummary(d.data);
        }
        if (topRes.ok) {
          const d = await topRes.json();
          setTopProducts(d.data ?? []);
        }
        if (!sumRes.ok && !topRes.ok) {
          setError("Could not load dashboard data.");
        }
      } catch {
        setError("Network error loading dashboard.");
      } finally {
        setLoading(false);
      }
    }

    load();
  }, []);

  const pct = summary ? pctLabel(summary.pctChange) : null;

  return (
    <div>
      <div style={{ marginBottom: "1.25rem" }}>
        <h1 style={{ margin: 0, fontSize: "1.35rem", fontWeight: 800, letterSpacing: "-0.02em" }}>Overview</h1>
        <p className="muted" style={{ margin: "0.2rem 0 0" }}>Last 30 days performance</p>
      </div>

      {error && <div className="signin-error" style={{ marginBottom: "1rem" }}>{error}</div>}

      {loading ? (
        <div className="stat-grid">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="stat-card" style={{ background: "linear-gradient(90deg,#f3f4f6 0%,#e5e7eb 50%,#f3f4f6 100%)", backgroundSize: "200% 100%", animation: "shimmer 1.8s infinite", minHeight: "90px" }} />
          ))}
        </div>
      ) : summary ? (
        <div className="stat-grid">
          <div className="stat-card">
            <div className="stat-label">Revenue (30d)</div>
            <div className="stat-value">{fmt(summary.last30.revenue)}</div>
            {pct && <div className={`stat-sub ${summary.pctChange! >= 0 ? "stat-up" : "stat-down"}`}>{pct}</div>}
          </div>
          <div className="stat-card">
            <div className="stat-label">Orders (30d)</div>
            <div className="stat-value">{summary.last30.orders}</div>
            <div className="stat-sub">
              {summary.last30.onlineOrders} online · {summary.last30.counterOrders} counter
            </div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Avg order value</div>
            <div className="stat-value">{fmt(summary.last30.avgOrder)}</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">All-time revenue</div>
            <div className="stat-value">{fmt(summary.allTime.revenue)}</div>
            <div className="stat-sub">{summary.allTime.orders} total orders</div>
          </div>
        </div>
      ) : null}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: "1rem", marginTop: "0.5rem" }}>
        {/* Quick links */}
        <div className="card">
          <h3 style={{ margin: "0 0 0.75rem" }}>Quick links</h3>
          <div style={{ display: "grid", gap: "0.4rem" }}>
            {[
              { label: "New sale (POS)", href: "/pos", icon: "🖥" },
              { label: "View orders", href: "/dashboard/orders", icon: "🧾" },
              { label: "Manage products", href: "/dashboard/products", icon: "📦" },
              { label: "Receive stock", href: "/dashboard/purchases", icon: "🛒" },
              { label: "AI recommendations", href: "/dashboard/ai", icon: "✦" },
              { label: "Bank reconciliation", href: "/dashboard/banking", icon: "🏦" },
            ].map((link) => (
              <a
                key={link.href}
                href={link.href}
                style={{ display: "flex", alignItems: "center", gap: "0.6rem", padding: "0.5rem 0.75rem", borderRadius: "8px", background: "#f8fafc", border: "1px solid var(--border)", fontWeight: 700, fontSize: "0.9rem" }}
              >
                <span>{link.icon}</span> {link.label}
              </a>
            ))}
          </div>
        </div>

        {/* Top products */}
        {topProducts.length > 0 && (
          <div className="card">
            <h3 style={{ margin: "0 0 0.75rem" }}>Top products by units sold</h3>
            <div style={{ display: "grid", gap: "0.4rem" }}>
              {topProducts.slice(0, 8).map((p, i) => (
                <div key={p.productId} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0.45rem 0", borderBottom: "1px solid var(--border)" }}>
                  <span style={{ fontWeight: 700, fontSize: "0.88rem" }}>
                    <span style={{ color: "var(--muted)", marginRight: "0.5rem" }}>{i + 1}.</span>
                    {p.name}
                  </span>
                  <span style={{ fontSize: "0.82rem", color: "var(--muted)", fontWeight: 600 }}>{p.qtySold} units</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
