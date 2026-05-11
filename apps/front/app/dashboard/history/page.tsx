"use client";

import { useEffect, useRef, useState } from "react";

const apiBase = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

function fmt(n: number) {
  return "KES " + (n ?? 0).toLocaleString("en-KE", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}
function fmtQty(n: number) {
  return (n > 0 ? "+" : "") + n.toLocaleString("en-KE");
}

type Tab = "summary" | "transactions" | "stock";

// ── Summary Tab ───────────────────────────────────────────────
function SummaryTab({ date, token }: { date: string; token: string }) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!date) return;
    setLoading(true);
    fetch(`${apiBase}/history/summary/${date}`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json()).then(setData).catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [date, token]);

  if (loading) return <p className="muted">Loading…</p>;
  if (!data)   return <p className="muted">No backup data for this date.</p>;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      {/* KPI row */}
      <div className="stat-grid">
        {[
          { label: "Total Sales",    value: fmt(data.totalSales),    sub: `${data.transactions} posted transactions` },
          { label: "VAT Collected",  value: fmt(data.totalTax),      sub: "" },
          { label: "Purchases",      value: fmt(data.totalPurchases), sub: "goods received" },
          { label: "Draft Sales",    value: fmt(data.draftTotal),    sub: `${data.draftCount} unposted` },
        ].map(s => (
          <div key={s.label} className="stat-card">
            <div className="stat-label">{s.label}</div>
            <div className="stat-value" style={{ fontSize: "1.3rem" }}>{s.value}</div>
            {s.sub && <div className="muted" style={{ fontSize: "0.75rem", marginTop: 2 }}>{s.sub}</div>}
          </div>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px,1fr))", gap: "1rem" }}>
        {/* Payment breakdown */}
        {data.paymentBreakdown?.length > 0 && (
          <div className="card">
            <h3 style={{ margin: "0 0 0.75rem", fontSize: "0.95rem", fontWeight: 700 }}>Payment Breakdown</h3>
            <table className="data-table">
              <thead><tr><th>Method</th><th>Txns</th><th>Total</th></tr></thead>
              <tbody>
                {data.paymentBreakdown.map((p: any) => (
                  <tr key={p.name}>
                    <td><strong>{p.name}</strong></td>
                    <td>{p.transactions}</td>
                    <td>{fmt(p.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Staff performance */}
        {data.byStaff?.length > 0 && (
          <div className="card">
            <h3 style={{ margin: "0 0 0.75rem", fontSize: "0.95rem", fontWeight: 700 }}>Staff Performance</h3>
            <table className="data-table">
              <thead><tr><th>Staff</th><th>Sales</th><th>Total</th><th>Returns</th></tr></thead>
              <tbody>
                {data.byStaff.map((s: any) => (
                  <tr key={s.staff}>
                    <td><strong>{s.staff}</strong></td>
                    <td>{s.transactions}</td>
                    <td>{fmt(s.total)}</td>
                    <td style={{ color: s.returns > 0 ? "#dc2626" : "inherit" }}>
                      {s.returns > 0 ? `-${fmt(s.returns)}` : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Transactions Tab ──────────────────────────────────────────
function TransactionsTab({ date, token }: { date: string; token: string }) {
  const [data, setData]     = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [filters, setFilters] = useState({ staff: "", method: "", minAmount: "", search: "", posted: "" });
  const [page, setPage]     = useState(1);

  function load(p = 1) {
    if (!date) return;
    setLoading(true);
    const q = new URLSearchParams({ page: String(p), ...Object.fromEntries(Object.entries(filters).filter(([, v]) => v)) });
    fetch(`${apiBase}/history/transactions/${date}?${q}`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json()).then(d => { setData(d); setPage(p); }).catch(() => setData(null))
      .finally(() => setLoading(false));
  }

  useEffect(() => { load(1); }, [date]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
      {/* Filters */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px,1fr))", gap: "0.5rem" }}>
        {[
          { key: "search",    label: "Receipt / Product",  placeholder: "Search…" },
          { key: "staff",     label: "Staff",               placeholder: "e.g. NANCY" },
          { key: "method",    label: "Payment Method",      placeholder: "e.g. MPESA" },
          { key: "minAmount", label: "Min Amount (KES)",    placeholder: "e.g. 1000" },
        ].map(f => (
          <div key={f.key}>
            <label className="input-label">{f.label}</label>
            <input className="input-field" placeholder={f.placeholder}
              value={(filters as any)[f.key]}
              onChange={e => setFilters(prev => ({ ...prev, [f.key]: e.target.value }))} />
          </div>
        ))}
        <div>
          <label className="input-label">Status</label>
          <select className="input-field" value={filters.posted}
            onChange={e => setFilters(prev => ({ ...prev, posted: e.target.value }))}>
            <option value="">All</option>
            <option value="1">Posted</option>
            <option value="0">Draft</option>
          </select>
        </div>
        <div style={{ display: "flex", alignItems: "flex-end" }}>
          <button className="button" style={{ width: "100%" }} onClick={() => load(1)} disabled={loading}>
            {loading ? "Loading…" : "Apply"}
          </button>
        </div>
      </div>

      {data && (
        <div className="muted" style={{ fontSize: "0.82rem" }}>
          {data.total.toLocaleString()} transactions · page {data.page} of {data.pages}
        </div>
      )}

      {data?.rows?.length > 0 ? (
        <div className="card" style={{ padding: 0, overflow: "hidden" }}>
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr><th>Receipt</th><th>Time</th><th>Staff</th><th>Amount</th><th>Method</th><th>Status</th><th></th></tr>
              </thead>
              <tbody>
                {data.rows.map((h: any) => (
                  <>
                    <tr key={h.receiptno} style={{ cursor: "pointer" }} onClick={() => setExpanded(expanded === h.receiptno ? null : h.receiptno)}>
                      <td style={{ fontWeight: 600 }}>{h.receiptno}</td>
                      <td className="muted" style={{ fontSize: "0.8rem" }}>
                        {h.trandate ? new Date(h.trandate).toLocaleTimeString("en-KE", { hour: "2-digit", minute: "2-digit" }) : "—"}
                      </td>
                      <td>{h.staff}</td>
                      <td style={{ fontWeight: 600 }}>{fmt(h.amount)}</td>
                      <td style={{ fontSize: "0.8rem" }}>{h.methods.join(", ") || "—"}</td>
                      <td>
                        <span style={{ fontSize: "0.72rem", fontWeight: 700, padding: "0.1rem 0.45rem", borderRadius: 99,
                          background: h.posted === 1 ? "#dcfce7" : "#fef9c3",
                          color: h.posted === 1 ? "#166534" : "#854d0e" }}>
                          {h.is_return === 1 ? "Return" : h.posted === 1 ? "Posted" : "Draft"}
                        </span>
                      </td>
                      <td style={{ color: "var(--muted)" }}>{expanded === h.receiptno ? "▲" : "▼"}</td>
                    </tr>
                    {expanded === h.receiptno && h.items?.length > 0 && (
                      <tr key={`${h.receiptno}-items`}>
                        <td colSpan={7} style={{ padding: 0, background: "#f9fafb" }}>
                          <table style={{ width: "100%", fontSize: "0.82rem", borderCollapse: "collapse" }}>
                            <thead>
                              <tr style={{ borderBottom: "1px solid var(--border)" }}>
                                <th style={{ padding: "0.4rem 0.75rem", textAlign: "left" }}>Code</th>
                                <th style={{ padding: "0.4rem 0.75rem", textAlign: "left" }}>Product</th>
                                <th style={{ padding: "0.4rem 0.75rem", textAlign: "right" }}>Qty</th>
                                <th style={{ padding: "0.4rem 0.75rem", textAlign: "right" }}>Price</th>
                                <th style={{ padding: "0.4rem 0.75rem", textAlign: "right" }}>Total</th>
                              </tr>
                            </thead>
                            <tbody>
                              {h.items.map((d: any, i: number) => (
                                <tr key={i} style={{ borderBottom: "1px solid #f3f4f6" }}>
                                  <td style={{ padding: "0.35rem 0.75rem", color: "var(--muted)" }}>{d.code}</td>
                                  <td style={{ padding: "0.35rem 0.75rem" }}>{d.description}</td>
                                  <td style={{ padding: "0.35rem 0.75rem", textAlign: "right" }}>{d.qty}</td>
                                  <td style={{ padding: "0.35rem 0.75rem", textAlign: "right" }}>{fmt(d.price)}</td>
                                  <td style={{ padding: "0.35rem 0.75rem", textAlign: "right", fontWeight: 600 }}>{fmt(d.total)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </td>
                      </tr>
                    )}
                  </>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : !loading && <p className="muted">No transactions found.</p>}

      {data && data.pages > 1 && (
        <div style={{ display: "flex", gap: "0.5rem", justifyContent: "center" }}>
          <button className="button ghost" disabled={page <= 1} onClick={() => load(page - 1)}>← Prev</button>
          <span className="muted" style={{ lineHeight: "2rem" }}>Page {page} / {data.pages}</span>
          <button className="button ghost" disabled={page >= data.pages} onClick={() => load(page + 1)}>Next →</button>
        </div>
      )}
    </div>
  );
}

// ── Stock Movements Tab ───────────────────────────────────────
function StockTab({ date, token }: { date: string; token: string }) {
  const [data, setData]     = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [type, setType]     = useState("");
  const [page, setPage]     = useState(1);

  function load(p = 1) {
    if (!date) return;
    setLoading(true);
    const q = new URLSearchParams({ page: String(p), ...(search ? { search } : {}), ...(type ? { type } : {}) });
    fetch(`${apiBase}/history/stock/${date}?${q}`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json()).then(d => { setData(d); setPage(p); }).catch(() => setData(null))
      .finally(() => setLoading(false));
  }

  useEffect(() => { load(1); }, [date]);

  const typeLabel: Record<string, string> = { r: "Received", SALES: "Sale", ADJ: "Adjustment" };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 160px 100px", gap: "0.5rem", maxWidth: 600 }}>
        <div>
          <label className="input-label">Product search</label>
          <input className="input-field" placeholder="Name or SKU…" value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <div>
          <label className="input-label">Movement type</label>
          <select className="input-field" value={type} onChange={e => setType(e.target.value)}>
            <option value="">All</option>
            <option value="in">Stock In (received)</option>
            <option value="out">Stock Out (sales)</option>
            <option value="adj">Adjustments</option>
          </select>
        </div>
        <div style={{ display: "flex", alignItems: "flex-end" }}>
          <button className="button" style={{ width: "100%" }} onClick={() => load(1)} disabled={loading}>
            {loading ? "…" : "Apply"}
          </button>
        </div>
      </div>

      {data && <div className="muted" style={{ fontSize: "0.82rem" }}>{data.total.toLocaleString()} movements</div>}

      {data?.rows?.length > 0 ? (
        <div className="card" style={{ padding: 0, overflow: "hidden" }}>
          <div className="table-wrap">
            <table className="data-table">
              <thead><tr><th>Code</th><th>Product</th><th>Qty</th><th>Price</th><th>Total</th><th>Type</th><th>Staff</th></tr></thead>
              <tbody>
                {data.rows.map((s: any, i: number) => (
                  <tr key={i}>
                    <td className="muted" style={{ fontSize: "0.78rem" }}>{s.code}</td>
                    <td style={{ maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.descr}</td>
                    <td style={{ fontWeight: 700, color: s.qty > 0 ? "#16a34a" : "#dc2626" }}>{fmtQty(s.qty)}</td>
                    <td>{s.price > 0 ? fmt(s.price) : "—"}</td>
                    <td>{s.total > 0 ? fmt(s.total) : "—"}</td>
                    <td style={{ fontSize: "0.78rem" }}>{typeLabel[s.tt] ?? s.tt ?? "—"}</td>
                    <td className="muted" style={{ fontSize: "0.78rem" }}>{s.staff}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : !loading && <p className="muted">No stock movements found.</p>}

      {data && data.pages > 1 && (
        <div style={{ display: "flex", gap: "0.5rem", justifyContent: "center" }}>
          <button className="button ghost" disabled={page <= 1} onClick={() => load(page - 1)}>← Prev</button>
          <span className="muted" style={{ lineHeight: "2rem" }}>Page {page} / {data.pages}</span>
          <button className="button ghost" disabled={page >= data.pages} onClick={() => load(page + 1)}>Next →</button>
        </div>
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────
export default function HistoryPage() {
  const [token, setToken]   = useState("");
  const [dates, setDates]   = useState<string[]>([]);
  const [date, setDate]     = useState("");
  const [tab, setTab]       = useState<Tab>("summary");

  useEffect(() => {
    const t = localStorage.getItem("mwalimu_token") ?? "";
    setToken(t);
    fetch(`${apiBase}/history/dates`, { headers: { Authorization: `Bearer ${t}` } })
      .then(r => r.json())
      .then(d => { setDates(d); if (d.length > 0) setDate(d[0]); })
      .catch(() => {});
  }, []);

  const tabs: { key: Tab; label: string }[] = [
    { key: "summary",      label: "Daily Summary" },
    { key: "transactions", label: "Transactions" },
    { key: "stock",        label: "Stock Movements" },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
      <div>
        <h2 style={{ margin: 0, fontWeight: 800, letterSpacing: "-0.02em" }}>Historical Data</h2>
        <p className="muted" style={{ margin: "0.2rem 0 0", fontSize: "0.85rem" }}>
          Browse daily backups of POS data. Backups are created at 5 PM each day.
        </p>
      </div>

      {dates.length === 0 ? (
        <div className="card" style={{ textAlign: "center", padding: "2.5rem" }}>
          <div style={{ fontSize: "2rem", marginBottom: "0.5rem" }}>📦</div>
          <h3 style={{ margin: "0 0 0.4rem" }}>No backups yet</h3>
          <p className="muted" style={{ margin: 0 }}>
            Backups are created at 5 PM daily by the sync agent. Run the latest{" "}
            <strong>install.bat</strong> on the shop PC to register the backup task.
          </p>
        </div>
      ) : (
        <>
          {/* Date picker */}
          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", flexWrap: "wrap" }}>
            <label style={{ fontWeight: 700, fontSize: "0.9rem" }}>Select date:</label>
            <select className="input-field" style={{ maxWidth: 200 }} value={date}
              onChange={e => { setDate(e.target.value); setTab("summary"); }}>
              {dates.map(d => (
                <option key={d} value={d}>
                  {new Date(d + "T12:00:00").toLocaleDateString("en-KE", { weekday: "short", day: "numeric", month: "short", year: "numeric" })}
                </option>
              ))}
            </select>
            <span className="muted" style={{ fontSize: "0.82rem" }}>{dates.length} backup{dates.length !== 1 ? "s" : ""} available</span>
          </div>

          {/* Tab selector */}
          <div style={{ display: "flex", gap: "0.5rem", borderBottom: "1px solid var(--border)", paddingBottom: "0.5rem" }}>
            {tabs.map(t => (
              <button key={t.key} onClick={() => setTab(t.key)}
                style={{ border: "none", cursor: "pointer", fontFamily: "inherit",
                  padding: "0.4rem 0.9rem", borderRadius: 8, fontWeight: tab === t.key ? 700 : 400,
                  color: tab === t.key ? "var(--teal)" : "var(--muted)",
                  background: tab === t.key ? "#f0fdf4" : "none" }}>
                {t.label}
              </button>
            ))}
          </div>

          {/* Active tab */}
          {date && tab === "summary"      && <SummaryTab      date={date} token={token} />}
          {date && tab === "transactions" && <TransactionsTab date={date} token={token} />}
          {date && tab === "stock"        && <StockTab        date={date} token={token} />}
        </>
      )}
    </div>
  );
}
