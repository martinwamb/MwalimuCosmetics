"use client";

import { useEffect, useRef, useState } from "react";

const apiBase = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
const POLL_MS = 60 * 1000; // re-fetch every 60 seconds

type PaymentBreakdown = { name: string; transactions: number; total: number };
type TopProduct       = { code: string; name: string; qtySold: number; revenue: number };
type StaffRow         = { staff: string; transactions: number; total: number };
type Snapshot = {
  forDate: string; capturedAt: string;
  transactions: number; totalSales: number;
  cashSales: number; mpesaSales: number; otherSales: number;
  paymentBreakdown: PaymentBreakdown[];
  topProducts: TopProduct[];
  byStaff: StaffRow[];
};

function fmt(n: number) {
  return "KES " + n.toLocaleString("en-KE", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

export default function DashboardPage() {
  const [token, setToken]         = useState("");
  const [snap, setSnap]           = useState<Snapshot | null>(null);
  const [loading, setLoading]     = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lastFetch, setLastFetch] = useState<Date | null>(null);
  const [countdown, setCountdown] = useState(POLL_MS / 1000);
  const timerRef    = useRef<ReturnType<typeof setInterval> | null>(null);
  const countRef    = useRef<ReturnType<typeof setInterval> | null>(null);
  const tokenRef    = useRef("");

  useEffect(() => {
    const t = localStorage.getItem("mwalimu_token") ?? "";
    setToken(t);
    tokenRef.current = t;
  }, []);

  function fetchMetrics(isManual = false) {
    if (!tokenRef.current) return;
    if (isManual) setRefreshing(true);
    fetch(`${apiBase}/sync/metrics/latest`, {
      headers: { Authorization: `Bearer ${tokenRef.current}` },
      cache: "no-store",
    })
      .then(r => r.json())
      .then(d => { setSnap(d); setLastFetch(new Date()); setCountdown(POLL_MS / 1000); })
      .catch(() => {})
      .finally(() => { setLoading(false); setRefreshing(false); });
  }

  useEffect(() => {
    if (!token) return;

    fetchMetrics();

    timerRef.current = setInterval(() => fetchMetrics(), POLL_MS);
    countRef.current = setInterval(() => setCountdown(c => c <= 1 ? POLL_MS / 1000 : c - 1), 1000);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (countRef.current) clearInterval(countRef.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const avg = snap && snap.transactions > 0 ? snap.totalSales / snap.transactions : 0;

  if (loading) return (
    <div className="dash-coming-soon">
      <div className="dash-coming-soon-icon" style={{ fontSize:"2rem" }}>⏳</div>
      <h2>Loading…</h2>
    </div>
  );

  if (!snap) return (
    <div className="dash-coming-soon">
      <div className="dash-coming-soon-icon">📡</div>
      <h2>No data yet</h2>
      <p>Install the sync agent on a bridge PC — data will appear within 10 minutes.</p>
      <a href="/MwalimuSyncAgent.zip" download className="button" style={{ marginTop:"0.5rem", textDecoration:"none" }}>
        Download Sync Agent
      </a>
    </div>
  );

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:"1.25rem" }}>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", flexWrap:"wrap", gap:"0.75rem" }}>
        <div>
          <h2 style={{ margin:0, fontWeight:800, letterSpacing:"-0.02em" }}>
            {new Date(snap.forDate).toLocaleDateString("en-KE", { weekday:"long", day:"numeric", month:"long", year:"numeric" })}
          </h2>
          <p className="muted" style={{ margin:0, fontSize:"0.82rem" }}>
            POS data as of {new Date(snap.capturedAt).toLocaleTimeString("en-KE", { hour:"2-digit", minute:"2-digit" })}
            {lastFetch && <> &middot; page fetched {lastFetch.toLocaleTimeString("en-KE", { hour:"2-digit", minute:"2-digit" })}</>}
          </p>
        </div>
        <div style={{ display:"flex", alignItems:"center", gap:"0.75rem" }}>
          <div style={{ display:"flex", alignItems:"center", gap:"0.4rem", fontSize:"0.82rem", color:"var(--muted)" }}>
            <span style={{ display:"inline-block", width:8, height:8, borderRadius:"50%", background: refreshing ? "#f59e0b" : "#10b981", animation: refreshing ? "pulse 1s infinite" : "none" }} />
            {refreshing ? "Refreshing…" : `Next refresh in ${countdown}s`}
          </div>
          <button
            className="button ghost"
            style={{ padding:"0.3rem 0.75rem", fontSize:"0.82rem" }}
            disabled={refreshing}
            onClick={() => fetchMetrics(true)}>
            ↺ Refresh now
          </button>
        </div>
      </div>

      <div className="stat-grid">
        {[
          { label: "Total Sales",   value: fmt(snap.totalSales) },
          { label: "Transactions",  value: snap.transactions.toLocaleString() },
          { label: "Average Sale",  value: fmt(avg) },
          { label: "Cash",          value: fmt(snap.cashSales) },
          { label: "M-Pesa",        value: fmt(snap.mpesaSales) },
          { label: "Other",         value: fmt(snap.otherSales) },
        ].map(s => (
          <div key={s.label} className="stat-card">
            <div className="stat-label">{s.label}</div>
            <div className="stat-value">{s.value}</div>
          </div>
        ))}
      </div>

      {snap.paymentBreakdown?.length > 0 && (
        <div className="card">
          <h3 style={{ margin:"0 0 0.75rem", fontSize:"0.95rem", fontWeight:700 }}>Payment Breakdown</h3>
          <div className="table-wrap">
            <table className="data-table">
              <thead><tr><th>Method</th><th>Transactions</th><th>Total</th><th>Share</th></tr></thead>
              <tbody>
                {snap.paymentBreakdown.map(p => (
                  <tr key={p.name}>
                    <td><strong>{p.name}</strong></td>
                    <td>{p.transactions.toLocaleString()}</td>
                    <td>{fmt(p.total)}</td>
                    <td>
                      <div style={{ display:"flex", alignItems:"center", gap:"0.5rem" }}>
                        <div style={{ flex:1, height:6, background:"#f3f4f6", borderRadius:99 }}>
                          <div style={{ width:`${Math.round(p.total/snap.totalSales*100)}%`, height:"100%", background:"var(--teal)", borderRadius:99 }} />
                        </div>
                        <span style={{ fontSize:"0.82rem", minWidth:34 }}>{Math.round(p.total/snap.totalSales*100)}%</span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(320px,1fr))", gap:"1.25rem" }}>
        {snap.topProducts?.length > 0 && (
          <div className="card">
            <h3 style={{ margin:"0 0 0.75rem", fontSize:"0.95rem", fontWeight:700 }}>Top Products Today</h3>
            <div className="table-wrap">
              <table className="data-table">
                <thead><tr><th>#</th><th>Product</th><th>Qty</th><th>Revenue</th></tr></thead>
                <tbody>
                  {snap.topProducts.map((p, i) => (
                    <tr key={p.code}>
                      <td className="muted">{i + 1}</td>
                      <td style={{ maxWidth:180, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{p.name}</td>
                      <td>{p.qtySold}</td>
                      <td>{fmt(p.revenue)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
        {snap.byStaff?.length > 0 && (
          <div className="card">
            <h3 style={{ margin:"0 0 0.75rem", fontSize:"0.95rem", fontWeight:700 }}>Staff Performance</h3>
            <div className="table-wrap">
              <table className="data-table">
                <thead><tr><th>Staff</th><th>Sales</th><th>Total</th></tr></thead>
                <tbody>
                  {snap.byStaff.map(s => (
                    <tr key={s.staff}>
                      <td><strong>{s.staff}</strong></td>
                      <td>{s.transactions}</td>
                      <td>{fmt(s.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
