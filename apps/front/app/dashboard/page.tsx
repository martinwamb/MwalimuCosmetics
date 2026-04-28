"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

const apiBase = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

type PaymentBreakdown = { name: string; transactions: number; total: number };
type TopProduct     = { code: string; name: string; qtySold: number; revenue: number };
type StaffRow       = { staff: string; transactions: number; total: number };

type Snapshot = {
  forDate: string;
  capturedAt: string;
  transactions: number;
  totalSales: number;
  cashSales: number;
  mpesaSales: number;
  otherSales: number;
  paymentBreakdown: PaymentBreakdown[];
  topProducts: TopProduct[];
  byStaff: StaffRow[];
};

function fmt(n: number) {
  return "KES " + n.toLocaleString("en-KE", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

function friendlyRole(role: string | null) {
  switch (role) {
    case "ADMIN": return "Administrator";
    case "ACCOUNTS": return "Accounts";
    case "SALES": return "Sales";
    default: return role ?? "Staff";
  }
}

export default function DashboardPage() {
  const [email, setEmail]     = useState<string | null>(null);
  const [role, setRole]       = useState<string | null>(null);
  const [token, setToken]     = useState<string | null>(null);
  const [snap, setSnap]       = useState<Snapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);
  const router = useRouter();

  useEffect(() => {
    const t = localStorage.getItem("mwalimu_token");
    const e = localStorage.getItem("mwalimu_email");
    const r = localStorage.getItem("mwalimu_role");
    if (!t) { router.push("/sign-in"); return; }
    setToken(t); setEmail(e); setRole(r);
  }, [router]);

  useEffect(() => {
    if (!token) return;
    setLoading(true);
    fetch(`${apiBase}/sync/metrics/latest`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(r => r.json())
      .then(d => { setSnap(d); setLoading(false); })
      .catch(() => { setError("Could not load metrics."); setLoading(false); });
  }, [token]);

  function handleSignOut() {
    try {
      localStorage.removeItem("mwalimu_token");
      localStorage.removeItem("mwalimu_role");
      localStorage.removeItem("mwalimu_email");
    } catch { /* ignore */ }
    router.push("/sign-in");
  }

  const avg = snap && snap.transactions > 0
    ? snap.totalSales / snap.transactions : 0;

  return (
    <div className="dash-single-root">
      <div className="dash-single-topbar">
        <span className="dash-single-brand">Mwalimu Cosmetics</span>
        <div className="dash-single-user">
          {email && <span className="dash-single-email">{email}</span>}
          <span className="dash-role-badge">{friendlyRole(role)}</span>
          <button type="button" className="button ghost"
            style={{ padding: "0.3rem 0.75rem", fontSize: "0.82rem" }}
            onClick={handleSignOut}>
            Sign out
          </button>
        </div>
      </div>

      <div className="dash-content" style={{ padding: "1.5rem" }}>
        {loading && (
          <div className="dash-coming-soon">
            <div className="dash-coming-soon-icon">⏳</div>
            <h2>Loading metrics…</h2>
          </div>
        )}

        {!loading && error && (
          <div className="dash-coming-soon">
            <div className="dash-coming-soon-icon">📡</div>
            <h2>No data yet</h2>
            <p>The bridge PC hasn&apos;t pushed today&apos;s data yet. It syncs every 10 minutes once the installer is running.</p>
          </div>
        )}

        {!loading && !error && !snap && (
          <div className="dash-coming-soon">
            <div className="dash-coming-soon-icon">📡</div>
            <h2>Waiting for first sync</h2>
            <p>Install the sync agent on a bridge PC and data will appear here within 10 minutes.</p>
          </div>
        )}

        {!loading && snap && (
          <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>

            {/* Header */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "0.5rem" }}>
              <div>
                <h2 style={{ margin: 0, fontSize: "1.3rem", fontWeight: 800 }}>
                  {new Date(snap.forDate).toLocaleDateString("en-KE", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
                </h2>
                <p className="muted" style={{ margin: 0, fontSize: "0.82rem" }}>
                  Last updated: {new Date(snap.capturedAt).toLocaleTimeString("en-KE", { hour: "2-digit", minute: "2-digit" })}
                </p>
              </div>
            </div>

            {/* Top stats */}
            <div className="stat-grid">
              <div className="stat-card">
                <div className="stat-label">Total Sales</div>
                <div className="stat-value">{fmt(snap.totalSales)}</div>
              </div>
              <div className="stat-card">
                <div className="stat-label">Transactions</div>
                <div className="stat-value">{snap.transactions.toLocaleString()}</div>
              </div>
              <div className="stat-card">
                <div className="stat-label">Average Sale</div>
                <div className="stat-value">{fmt(avg)}</div>
              </div>
              <div className="stat-card">
                <div className="stat-label">Cash</div>
                <div className="stat-value">{fmt(snap.cashSales)}</div>
              </div>
              <div className="stat-card">
                <div className="stat-label">M-Pesa</div>
                <div className="stat-value">{fmt(snap.mpesaSales)}</div>
              </div>
              <div className="stat-card">
                <div className="stat-label">Other</div>
                <div className="stat-value">{fmt(snap.otherSales)}</div>
              </div>
            </div>

            {/* Payment breakdown */}
            {snap.paymentBreakdown?.length > 0 && (
              <div className="card">
                <h3 style={{ margin: "0 0 0.75rem", fontSize: "0.95rem", fontWeight: 700 }}>Payment Breakdown</h3>
                <div className="table-wrap">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Method</th>
                        <th>Transactions</th>
                        <th>Total</th>
                        <th>Share</th>
                      </tr>
                    </thead>
                    <tbody>
                      {snap.paymentBreakdown.map(p => (
                        <tr key={p.name}>
                          <td><strong>{p.name}</strong></td>
                          <td>{p.transactions.toLocaleString()}</td>
                          <td>{fmt(p.total)}</td>
                          <td>
                            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                              <div style={{ flex: 1, height: 6, background: "#f3f4f6", borderRadius: 99 }}>
                                <div style={{ width: `${Math.round(p.total / snap.totalSales * 100)}%`, height: "100%", background: "var(--teal)", borderRadius: 99 }} />
                              </div>
                              <span style={{ fontSize: "0.82rem", minWidth: 36 }}>
                                {Math.round(p.total / snap.totalSales * 100)}%
                              </span>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: "1.25rem" }}>

              {/* Top products */}
              {snap.topProducts?.length > 0 && (
                <div className="card">
                  <h3 style={{ margin: "0 0 0.75rem", fontSize: "0.95rem", fontWeight: 700 }}>Top Products Today</h3>
                  <div className="table-wrap">
                    <table className="data-table">
                      <thead>
                        <tr><th>#</th><th>Product</th><th>Qty</th><th>Revenue</th></tr>
                      </thead>
                      <tbody>
                        {snap.topProducts.map((p, i) => (
                          <tr key={p.code}>
                            <td className="muted">{i + 1}</td>
                            <td style={{ maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              {p.name}
                            </td>
                            <td>{p.qtySold}</td>
                            <td>{fmt(p.revenue)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Staff performance */}
              {snap.byStaff?.length > 0 && (
                <div className="card">
                  <h3 style={{ margin: "0 0 0.75rem", fontSize: "0.95rem", fontWeight: 700 }}>Staff Performance Today</h3>
                  <div className="table-wrap">
                    <table className="data-table">
                      <thead>
                        <tr><th>Staff</th><th>Sales</th><th>Total</th></tr>
                      </thead>
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
        )}
      </div>
    </div>
  );
}
