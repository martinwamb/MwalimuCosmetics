"use client";

import { useEffect, useState } from "react";

const apiBase = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

function fmt(n: number) {
  return "KES " + (n ?? 0).toLocaleString("en-KE", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

function kenyanDate() {
  return new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function addDays(dateStr: string, n: number) {
  const d = new Date(dateStr + "T12:00:00Z");
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

type DayRow = { date: string; transactions: number; totalSales: number; purchases: number };
type Product = { code: string; name: string; qtySold: number; revenue: number };
type PayMethod = { method: string; transactions: number; total: number };
type Analytics = { salesByDate: DayRow[]; topProducts: Product[]; paymentSplit: PayMethod[] };

// ── Simple SVG bar chart ──────────────────────────────────────────────────────
function BarChart({ rows }: { rows: DayRow[] }) {
  if (!rows.length) return <p className="muted">No data for this period.</p>;

  const maxSales = Math.max(...rows.map(r => r.totalSales), 1);
  const maxPurch = Math.max(...rows.map(r => r.purchases), 1);
  const H = 140;
  const BAR_W = Math.max(4, Math.min(32, Math.floor(700 / rows.length) - 3));

  // Show x-axis labels every ~7 bars
  const labelEvery = Math.max(1, Math.ceil(rows.length / 10));

  return (
    <div>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 2, height: H + 20, overflowX: "auto", paddingBottom: 4 }}>
        {rows.map((r, i) => {
          const salesH = Math.round((r.totalSales / maxSales) * H);
          const purchH = Math.round((r.purchases / Math.max(maxPurch, maxSales)) * H);
          const label  = i % labelEvery === 0 ? r.date.slice(5) : "";
          return (
            <div key={r.date} style={{ display: "flex", flexDirection: "column", alignItems: "center", minWidth: BAR_W + 2 }}
              title={`${r.date}\nSales: ${fmt(r.totalSales)} (${r.transactions} txns)\nPurchases: ${fmt(r.purchases)}`}>
              <div style={{ display: "flex", alignItems: "flex-end", gap: 1, height: H }}>
                <div style={{ width: BAR_W, height: salesH, background: "var(--teal)", borderRadius: "2px 2px 0 0", minHeight: r.totalSales > 0 ? 2 : 0 }} />
                {r.purchases > 0 && (
                  <div style={{ width: Math.max(3, BAR_W * 0.5), height: purchH, background: "#f59e0b", borderRadius: "2px 2px 0 0", minHeight: 2, opacity: 0.8 }} />
                )}
              </div>
              {label && (
                <div style={{ fontSize: "0.6rem", color: "var(--muted)", marginTop: 2, transform: "rotate(-40deg)", whiteSpace: "nowrap", transformOrigin: "top left" }}>
                  {label}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div style={{ display: "flex", gap: "1rem", fontSize: "0.78rem", marginTop: 8 }}>
        <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <span style={{ width: 10, height: 10, background: "var(--teal)", display: "inline-block", borderRadius: 2 }} /> Sales
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <span style={{ width: 10, height: 10, background: "#f59e0b", display: "inline-block", borderRadius: 2 }} /> Purchases
        </span>
      </div>
    </div>
  );
}

export default function AnalyticsPage() {
  const today    = kenyanDate();
  const [from, setFrom]     = useState(() => addDays(today, -30));
  const [to, setTo]         = useState(today);
  const [data, setData]     = useState<Analytics | null>(null);
  const [loading, setLoading] = useState(false);
  const [token, setToken]   = useState("");
  const [error, setError]   = useState("");

  useEffect(() => { setToken(localStorage.getItem("mwalimu_token") ?? ""); }, []);

  function load(f = from, t = to) {
    if (!token) return;
    setLoading(true);
    setError("");
    fetch(`${apiBase}/sync/mirror/analytics?from=${f}&to=${t}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(r => r.json())
      .then(d => {
        if (d.error) { setError(d.error); setData(null); }
        else setData(d);
      })
      .catch(() => setError("Could not load analytics."))
      .finally(() => setLoading(false));
  }

  useEffect(() => { if (token) load(); }, [token]);

  // Period totals
  const totSales = data?.salesByDate.reduce((s, r) => s + r.totalSales, 0) ?? 0;
  const totTxns  = data?.salesByDate.reduce((s, r) => s + r.transactions, 0) ?? 0;
  const totPurch = data?.salesByDate.reduce((s, r) => s + r.purchases, 0) ?? 0;
  const totPmt   = data?.paymentSplit.reduce((s, r) => s + r.total, 0) ?? 1;
  const days     = data?.salesByDate.filter(r => r.totalSales > 0).length ?? 1;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
      {/* Header + date range */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "0.75rem" }}>
        <div>
          <h2 style={{ margin: 0, fontWeight: 800, letterSpacing: "-0.02em" }}>Analytics</h2>
          <p className="muted" style={{ margin: 0, fontSize: "0.85rem" }}>Trends from POS mirror data</p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
          <input type="date" value={from} max={to}
            onChange={e => setFrom(e.target.value)}
            className="filter-input" style={{ fontSize: "0.9rem" }} />
          <span className="muted">to</span>
          <input type="date" value={to} min={from} max={today}
            onChange={e => setTo(e.target.value)}
            className="filter-input" style={{ fontSize: "0.9rem" }} />
          <button className="button" style={{ padding: "0.35rem 0.9rem", fontSize: "0.9rem" }}
            disabled={loading} onClick={() => load(from, to)}>
            {loading ? "Loading…" : "Apply"}
          </button>
        </div>
      </div>

      {/* Quick range buttons */}
      <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap" }}>
        {[
          { label: "7 days",  days: 7 },
          { label: "30 days", days: 30 },
          { label: "90 days", days: 90 },
          { label: "6 months", days: 180 },
          { label: "1 year",  days: 365 },
        ].map(opt => (
          <button key={opt.label} className="button ghost"
            style={{ padding: "0.2rem 0.6rem", fontSize: "0.78rem" }}
            onClick={() => {
              const f = addDays(today, -opt.days);
              setFrom(f); setTo(today);
              load(f, today);
            }}>
            {opt.label}
          </button>
        ))}
      </div>

      {error && <div style={{ color: "#dc2626", fontSize: "0.9rem" }}>{error}</div>}

      {!loading && !data && !error && (
        <div className="dash-coming-soon">
          <div className="dash-coming-soon-icon">📊</div>
          <h2>No mirror data yet</h2>
          <p>Run the nightly mirror from the History page to populate analytics.</p>
        </div>
      )}

      {data && (
        <>
          {/* Period KPI cards */}
          <div className="stat-grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(170px,1fr))" }}>
            <div className="stat-card">
              <div className="stat-label">Total Sales</div>
              <div className="stat-value" style={{ fontSize: "1.3rem" }}>{fmt(totSales)}</div>
              <div className="muted" style={{ fontSize: "0.75rem" }}>{totTxns.toLocaleString()} transactions</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">Avg Daily Sales</div>
              <div className="stat-value" style={{ fontSize: "1.3rem" }}>{fmt(days > 0 ? totSales / days : 0)}</div>
              <div className="muted" style={{ fontSize: "0.75rem" }}>{days} trading days</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">Avg per Transaction</div>
              <div className="stat-value" style={{ fontSize: "1.3rem" }}>{fmt(totTxns > 0 ? totSales / totTxns : 0)}</div>
              <div className="muted" style={{ fontSize: "0.75rem" }}>basket size</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">Total Purchases</div>
              <div className="stat-value" style={{ fontSize: "1.3rem" }}>{fmt(totPurch)}</div>
              <div className="muted" style={{ fontSize: "0.75rem" }}>goods received</div>
            </div>
          </div>

          {/* Daily bar chart */}
          <div className="card">
            <h3 style={{ margin: "0 0 1rem", fontSize: "0.95rem", fontWeight: 700 }}>Daily Sales & Purchases</h3>
            <BarChart rows={data.salesByDate} />
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px,1fr))", gap: "1.25rem" }}>
            {/* Top products */}
            {data.topProducts.length > 0 && (
              <div className="card">
                <h3 style={{ margin: "0 0 0.75rem", fontSize: "0.95rem", fontWeight: 700 }}>Top Products</h3>
                <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                  {data.topProducts.slice(0, 15).map((p, i) => {
                    const pct = Math.round((p.revenue / data.topProducts[0].revenue) * 100);
                    return (
                      <div key={p.code}>
                        <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.82rem", marginBottom: 2 }}>
                          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "60%" }}>
                            <span className="muted" style={{ marginRight: 6 }}>{i + 1}.</span>
                            {p.name}
                          </span>
                          <span style={{ fontWeight: 700, whiteSpace: "nowrap", marginLeft: 8 }}>{fmt(p.revenue)}</span>
                        </div>
                        <div style={{ height: 5, background: "#f3f4f6", borderRadius: 99 }}>
                          <div style={{ width: `${pct}%`, height: "100%", background: "var(--teal)", borderRadius: 99 }} />
                        </div>
                        <div className="muted" style={{ fontSize: "0.7rem", marginTop: 1 }}>{p.qtySold.toLocaleString()} units sold</div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Payment split */}
            {data.paymentSplit.length > 0 && (
              <div className="card">
                <h3 style={{ margin: "0 0 0.75rem", fontSize: "0.95rem", fontWeight: 700 }}>Payment Methods</h3>
                <div className="table-wrap">
                  <table className="data-table">
                    <thead>
                      <tr><th>Method</th><th>Txns</th><th>Total</th><th>Share</th></tr>
                    </thead>
                    <tbody>
                      {data.paymentSplit.map(p => (
                        <tr key={p.method}>
                          <td><strong>{p.method}</strong></td>
                          <td>{p.transactions.toLocaleString()}</td>
                          <td>{fmt(p.total)}</td>
                          <td>
                            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                              <div style={{ flex: 1, height: 5, background: "#f3f4f6", borderRadius: 99 }}>
                                <div style={{ width: `${Math.min(100, Math.round(p.total / totPmt * 100))}%`, height: "100%", background: "var(--teal)", borderRadius: 99 }} />
                              </div>
                              <span style={{ fontSize: "0.78rem", minWidth: 30 }}>
                                {Math.round(p.total / totPmt * 100)}%
                              </span>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Credit vs cash summary */}
                {(() => {
                  const cash  = data.paymentSplit.filter(p => p.method === "CASH").reduce((s, p) => s + p.total, 0);
                  const mpesa = data.paymentSplit.filter(p => p.method === "MPESA").reduce((s, p) => s + p.total, 0);
                  const credit = totPmt - cash - mpesa;
                  if (credit <= 0) return null;
                  return (
                    <div style={{ marginTop: "0.75rem", fontSize: "0.8rem", color: "var(--muted)", borderTop: "1px solid var(--border)", paddingTop: "0.5rem" }}>
                      Cash {Math.round(cash / totPmt * 100)}% · Mpesa {Math.round(mpesa / totPmt * 100)}% · Credit accounts {Math.round(credit / totPmt * 100)}%
                    </div>
                  );
                })()}
              </div>
            )}
          </div>

          {/* Daily data table (collapsible) */}
          {data.salesByDate.length > 0 && (
            <details>
              <summary style={{ cursor: "pointer", fontWeight: 700, fontSize: "0.9rem", padding: "0.5rem 0", userSelect: "none" }}>
                Daily breakdown ({data.salesByDate.length} days)
              </summary>
              <div className="table-wrap" style={{ marginTop: "0.75rem" }}>
                <table className="data-table">
                  <thead><tr><th>Date</th><th>Transactions</th><th>Sales</th><th>Purchases</th></tr></thead>
                  <tbody>
                    {[...data.salesByDate].reverse().map(r => (
                      <tr key={r.date}>
                        <td>{new Date(r.date + "T12:00:00").toLocaleDateString("en-KE", { weekday: "short", day: "numeric", month: "short" })}</td>
                        <td>{r.transactions.toLocaleString()}</td>
                        <td style={{ fontWeight: 600 }}>{fmt(r.totalSales)}</td>
                        <td style={{ color: r.purchases > 0 ? "#f59e0b" : "var(--muted)" }}>
                          {r.purchases > 0 ? fmt(r.purchases) : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          )}
        </>
      )}
    </div>
  );
}
