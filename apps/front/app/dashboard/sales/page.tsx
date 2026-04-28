"use client";

import { useEffect, useState } from "react";

const apiBase = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

function fmt(n: number) {
  return n.toLocaleString("en-KE", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

export default function SalesPage() {
  const [token, setToken]   = useState("");
  const [date, setDate]     = useState(new Date().toISOString().slice(0, 10));
  const [sales, setSales]   = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => { setToken(localStorage.getItem("mwalimu_token") ?? ""); }, []);

  useEffect(() => {
    if (!token) return;
    setLoading(true);
    fetch(`${apiBase}/pos/sales?date=${date}`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json())
      .then(d => setSales(Array.isArray(d) ? d : []))
      .finally(() => setLoading(false));
  }, [token, date]);

  const total = sales.reduce((s, o) => s + Number(o.total), 0);

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:"1.25rem" }}>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", flexWrap:"wrap", gap:"0.75rem" }}>
        <div>
          <h2 style={{ margin:0, fontWeight:800, letterSpacing:"-0.02em" }}>Sales History</h2>
          <p className="muted" style={{ margin:0 }}>{sales.length} transactions · KES {fmt(total)}</p>
        </div>
        <input type="date" value={date} onChange={e => setDate(e.target.value)}
          className="filter-input" style={{ fontSize:"0.95rem" }} />
      </div>

      {loading && <div className="muted" style={{ padding:"2rem", textAlign:"center" }}>Loading…</div>}

      {!loading && !sales.length && (
        <div className="dash-coming-soon">
          <div className="dash-coming-soon-icon">🧾</div>
          <h2>No sales on this date</h2>
          <p>Select a different date or run a sale from the POS terminal.</p>
        </div>
      )}

      {!loading && sales.length > 0 && (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Time</th>
                <th>Items</th>
                <th>Payment</th>
                <th>Total</th>
                <th>Staff</th>
                <th>Synced</th>
              </tr>
            </thead>
            <tbody>
              {sales.map(sale => (
                <>
                  <tr key={sale.id} style={{ cursor:"pointer" }} onClick={() => setExpanded(expanded === sale.id ? null : sale.id)}>
                    <td>{new Date(sale.createdAt).toLocaleTimeString("en-KE", { hour:"2-digit", minute:"2-digit" })}</td>
                    <td>{sale.items?.length ?? 0} item{sale.items?.length !== 1 ? "s" : ""}</td>
                    <td>
                      <div style={{ display:"flex", gap:"0.3rem", flexWrap:"wrap" }}>
                        {sale.paymentDetails && Object.entries(sale.paymentDetails as Record<string,number>).filter(([k,v])=>k!=="ref"&&Number(v)>0).map(([k,v])=>(
                          <span key={k} className="chip chip-blue" style={{ fontSize:"0.72rem", textTransform:"none" }}>
                            {k.replace("_"," ")}: {fmt(Number(v))}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td><strong>KES {fmt(Number(sale.total))}</strong></td>
                    <td className="muted">{sale.createdBy?.name ?? "—"}</td>
                    <td>
                      <span className={`chip ${sale.mysqlSynced ? "chip-green" : "chip-yellow"}`}>
                        {sale.mysqlSynced ? "✓" : "Pending"}
                      </span>
                    </td>
                  </tr>
                  {expanded === sale.id && (
                    <tr key={sale.id + "-detail"}>
                      <td colSpan={6} style={{ background:"#f8fafc", padding:"0.75rem 1rem" }}>
                        <table style={{ width:"100%", fontSize:"0.85rem", borderCollapse:"collapse" }}>
                          <thead><tr><th style={{ textAlign:"left", padding:"0.25rem 0.5rem" }}>Product</th><th style={{ textAlign:"left" }}>Qty</th><th style={{ textAlign:"right" }}>Unit</th><th style={{ textAlign:"right" }}>Total</th></tr></thead>
                          <tbody>
                            {sale.items?.map((i: any, idx: number) => (
                              <tr key={idx}>
                                <td style={{ padding:"0.25rem 0.5rem" }}>{i.product?.name}</td>
                                <td>{i.qty}</td>
                                <td style={{ textAlign:"right" }}>KES {fmt(Number(i.unitPrice))}</td>
                                <td style={{ textAlign:"right" }}>KES {fmt(Number(i.unitPrice)*i.qty)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        {sale.amountPaid > sale.total && (
                          <div style={{ marginTop:"0.5rem", fontSize:"0.85rem" }}>
                            Paid: KES {fmt(Number(sale.amountPaid))} · Change: KES {fmt(Number(sale.changeDue))}
                          </div>
                        )}
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
