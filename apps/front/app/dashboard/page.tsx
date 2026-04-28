"use client";

import { useEffect, useState } from "react";

const apiBase = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

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
  const [token, setToken]   = useState("");
  const [snap, setSnap]     = useState<Snapshot | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => { setToken(localStorage.getItem("mwalimu_token") ?? ""); }, []);

  useEffect(() => {
    if (!token) return;
    fetch(`${apiBase}/sync/metrics/latest`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json())
      .then(d => { setSnap(d); setLoading(false); })
      .catch(() => setLoading(false));
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
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", flexWrap:"wrap", gap:"0.5rem" }}>
        <div>
          <h2 style={{ margin:0, fontWeight:800, letterSpacing:"-0.02em" }}>
            {new Date(snap.forDate).toLocaleDateString("en-KE", { weekday:"long", day:"numeric", month:"long", year:"numeric" })}
          </h2>
          <p className="muted" style={{ margin:0, fontSize:"0.82rem" }}>
            Last synced: {new Date(snap.capturedAt).toLocaleTimeString("en-KE", { hour:"2-digit", minute:"2-digit" })}
          </p>
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
