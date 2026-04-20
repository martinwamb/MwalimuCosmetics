"use client";

import { useEffect, useState } from "react";

const apiBase = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

type DailyRow = { date: string; revenue: number; orders: number };
type TopProduct = { productId: string; name: string; sku: string; qtySold: number; revenue: number };
type Summary = {
  last30: { revenue: number; orders: number; avgOrder: number; onlineOrders: number; counterOrders: number };
  prior30: { revenue: number; orders: number };
  pctChange: number | null;
  allTime: { revenue: number; orders: number };
};

function fmt(n: number) {
  return new Intl.NumberFormat("en-KE", { style: "currency", currency: "KES", maximumFractionDigits: 0 }).format(n);
}

export default function SalesPage() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [daily, setDaily] = useState<DailyRow[]>([]);
  const [top, setTop] = useState<TopProduct[]>([]);
  const [days, setDays] = useState(30);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const token = localStorage.getItem("mwalimu_token");
    if (!token) return;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const h = { Authorization: `Bearer ${token}` };
        const [sRes, dRes, tRes] = await Promise.all([
          fetch(`${apiBase}/reports/sales-summary`, { headers: h, cache: "no-store" }),
          fetch(`${apiBase}/reports/daily?days=${days}`, { headers: h, cache: "no-store" }),
          fetch(`${apiBase}/reports/top-products`, { headers: h, cache: "no-store" }),
        ]);
        if (sRes.ok) setSummary((await sRes.json()).data);
        if (dRes.ok) setDaily((await dRes.json()).data ?? []);
        if (tRes.ok) setTop((await tRes.json()).data ?? []);
        if (!sRes.ok) setError("Failed to load report data.");
      } catch {
        setError("Network error");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [days]);

  const maxRev = Math.max(...daily.map((d) => d.revenue), 1);

  return (
    <div>
      <h1 style={{ margin: "0 0 1rem", fontSize: "1.35rem", fontWeight: 800, letterSpacing: "-0.02em" }}>Sales Overview</h1>

      {error && <div className="signin-error" style={{ marginBottom: "1rem" }}>{error}</div>}

      {summary && (
        <div className="stat-grid" style={{ marginBottom: "1.5rem" }}>
          <div className="stat-card">
            <div className="stat-label">Revenue (30d)</div>
            <div className="stat-value">{fmt(summary.last30.revenue)}</div>
            {summary.pctChange !== null && (
              <div className={`stat-sub ${summary.pctChange >= 0 ? "stat-up" : "stat-down"}`}>
                {summary.pctChange >= 0 ? "+" : ""}{summary.pctChange.toFixed(1)}% vs prior period
              </div>
            )}
          </div>
          <div className="stat-card">
            <div className="stat-label">Orders (30d)</div>
            <div className="stat-value">{summary.last30.orders}</div>
            <div className="stat-sub">{summary.last30.onlineOrders} online · {summary.last30.counterOrders} counter</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Avg order value</div>
            <div className="stat-value">{fmt(summary.last30.avgOrder)}</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">All-time revenue</div>
            <div className="stat-value">{fmt(summary.allTime.revenue)}</div>
            <div className="stat-sub">{summary.allTime.orders} orders total</div>
          </div>
        </div>
      )}

      {/* Bar chart */}
      <div className="card" style={{ marginBottom: "1.5rem" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
          <h3 style={{ margin: 0 }}>Daily revenue</h3>
          <div style={{ display: "flex", gap: "0.4rem" }}>
            {[7, 14, 30, 60].map((d) => (
              <button key={d} className={`filter-chip ${days === d ? "active" : ""}`} style={{ fontSize: "0.8rem" }} onClick={() => setDays(d)}>{d}d</button>
            ))}
          </div>
        </div>
        {loading ? (
          <div style={{ height: "120px", background: "#f3f4f6", borderRadius: "8px", animation: "shimmer 1.8s infinite" }} />
        ) : (
          <div style={{ display: "flex", alignItems: "flex-end", gap: "2px", height: "120px", overflow: "hidden" }}>
            {daily.map((d) => (
              <div
                key={d.date}
                title={`${d.date}: ${fmt(d.revenue)} (${d.orders} orders)`}
                style={{
                  flex: 1,
                  background: d.revenue > 0 ? "linear-gradient(180deg, #f0c14b, #f7dfa5)" : "#e5e7eb",
                  height: `${Math.max((d.revenue / maxRev) * 100, d.revenue > 0 ? 4 : 1)}%`,
                  borderRadius: "3px 3px 0 0",
                  minWidth: "3px",
                  cursor: "default",
                  transition: "height 0.3s ease",
                }}
              />
            ))}
          </div>
        )}
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.75rem", color: "var(--muted)", marginTop: "0.3rem" }}>
          <span>{daily[0]?.date}</span>
          <span>{daily[daily.length - 1]?.date}</span>
        </div>
      </div>

      {/* Top products table */}
      {top.length > 0 && (
        <div className="card">
          <h3 style={{ margin: "0 0 0.75rem" }}>Top 10 products by units sold</h3>
          <div className="table-wrap" style={{ boxShadow: "none", border: "none" }}>
            <table className="data-table">
              <thead>
                <tr><th>#</th><th>Product</th><th>SKU</th><th>Units sold</th><th>Revenue</th></tr>
              </thead>
              <tbody>
                {top.map((p, i) => (
                  <tr key={p.productId}>
                    <td style={{ color: "var(--muted)", fontWeight: 700 }}>{i + 1}</td>
                    <td style={{ fontWeight: 700 }}>{p.name}</td>
                    <td style={{ fontFamily: "monospace", fontSize: "0.82rem" }}>{p.sku}</td>
                    <td style={{ fontWeight: 700 }}>{p.qtySold}</td>
                    <td style={{ fontWeight: 700 }}>{fmt(p.revenue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
