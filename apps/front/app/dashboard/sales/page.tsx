"use client";

import { useEffect, useState } from "react";

const apiBase = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

function fmt(n: number) {
  return "KES " + (n ?? 0).toLocaleString("en-KE", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

function kenyanDate() {
  return new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export default function SalesPage() {
  const [token, setToken]       = useState("");
  const [date, setDate]         = useState(kenyanDate);
  const [data, setData]         = useState<any>(null);
  const [loading, setLoading]   = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [page, setPage]         = useState(1);
  const [filters, setFilters]   = useState({ staff: "", method: "", minAmount: "", search: "", posted: "" });

  useEffect(() => { setToken(localStorage.getItem("mwalimu_token") ?? ""); }, []);

  function load(p = 1) {
    if (!token || !date) return;
    setLoading(true);
    setExpanded(null);
    const q = new URLSearchParams({
      date, page: String(p),
      ...Object.fromEntries(Object.entries(filters).filter(([, v]) => v)),
    });
    fetch(`${apiBase}/sync/mirror/sales?${q}`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json())
      .then(d => { setData(d); setPage(p); })
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }

  useEffect(() => { if (token) load(1); }, [token, date]);

  const totalOnPage = data?.rows?.reduce((s: number, r: any) => s + r.amount, 0) ?? 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "0.75rem" }}>
        <div>
          <h2 style={{ margin: 0, fontWeight: 800, letterSpacing: "-0.02em" }}>Sales History</h2>
          {data && (
            <p className="muted" style={{ margin: 0 }}>
              {data.total.toLocaleString()} transactions
              {data.total > 0 && ` · ${fmt(totalOnPage)} shown`}
            </p>
          )}
        </div>
        <input type="date" value={date} onChange={e => { setDate(e.target.value); setPage(1); }}
          className="filter-input" style={{ fontSize: "0.95rem" }} />
      </div>

      {/* Filters */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px,1fr))", gap: "0.5rem" }}>
        {[
          { key: "search",    label: "Receipt / Product", placeholder: "Search…" },
          { key: "staff",     label: "Staff",              placeholder: "e.g. NANCY" },
          { key: "method",    label: "Payment Method",     placeholder: "e.g. MPESA" },
          { key: "minAmount", label: "Min Amount (KES)",   placeholder: "e.g. 1000" },
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

      {loading && <div className="muted" style={{ padding: "2rem", textAlign: "center" }}>Loading…</div>}

      {!loading && data?.total === 0 && (
        <div className="dash-coming-soon">
          <div className="dash-coming-soon-icon">🧾</div>
          <h2>No transactions on this date</h2>
          <p>Select a different date or adjust your filters.</p>
        </div>
      )}

      {!loading && data?.rows?.length > 0 && (
        <>
          <div style={{ fontSize: "0.82rem", color: "var(--muted)" }}>
            {data.total.toLocaleString()} transactions · page {data.page} of {data.pages}
          </div>
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Receipt</th>
                  <th>Time</th>
                  <th>Staff</th>
                  <th>Amount</th>
                  <th>Payment</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((h: any) => (
                  <>
                    <tr key={h.receiptno} style={{ cursor: "pointer" }}
                      onClick={() => setExpanded(expanded === h.receiptno ? null : h.receiptno)}>
                      <td style={{ fontWeight: 600 }}>{h.receiptno}</td>
                      <td className="muted" style={{ fontSize: "0.8rem" }}>
                        {h.trandate ? new Date(h.trandate).toLocaleTimeString("en-KE", { hour: "2-digit", minute: "2-digit" }) : "—"}
                      </td>
                      <td>{h.staff}</td>
                      <td style={{ fontWeight: 600 }}>{fmt(h.amount)}</td>
                      <td style={{ fontSize: "0.78rem" }}>
                        <div style={{ display: "flex", gap: "0.25rem", flexWrap: "wrap" }}>
                          {(h.methods ?? []).map((m: string) => (
                            <span key={m} className="chip chip-blue" style={{ fontSize: "0.7rem" }}>{m}</span>
                          ))}
                          {!h.methods?.length && <span className="muted">—</span>}
                        </div>
                      </td>
                      <td>
                        <span style={{ fontSize: "0.72rem", fontWeight: 700, padding: "0.1rem 0.45rem", borderRadius: 99,
                          background: h.is_return === 1 ? "#fee2e2" : h.posted === 1 ? "#dcfce7" : "#fef9c3",
                          color: h.is_return === 1 ? "#991b1b" : h.posted === 1 ? "#166534" : "#854d0e" }}>
                          {h.is_return === 1 ? "Return" : h.posted === 1 ? "Posted" : "Draft"}
                        </span>
                      </td>
                      <td className="muted" style={{ fontSize: "0.75rem" }}>{expanded === h.receiptno ? "▲" : "▼"}</td>
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

          {data.pages > 1 && (
            <div style={{ display: "flex", gap: "0.5rem", justifyContent: "center" }}>
              <button className="button ghost" disabled={page <= 1} onClick={() => load(page - 1)}>← Prev</button>
              <span className="muted" style={{ lineHeight: "2rem" }}>Page {page} / {data.pages}</span>
              <button className="button ghost" disabled={page >= data.pages} onClick={() => load(page + 1)}>Next →</button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
