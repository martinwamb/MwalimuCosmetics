"use client";

import { useCallback, useEffect, useState } from "react";

const apiBase = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

type Recommendation = {
  id: string;
  type: "PRICE_GAP" | "SLOW_MOVER_DISCOUNT" | "SEASONAL_STOCK";
  status: "PENDING" | "APPROVED" | "APPLIED" | "DISMISSED";
  payload: Record<string, any>;
  createdAt: string;
  product?: { name: string; sku: string } | null;
};

const TYPE_LABELS: Record<string, string> = {
  PRICE_GAP: "Price Gap",
  SLOW_MOVER_DISCOUNT: "Slow Mover",
  SEASONAL_STOCK: "Seasonal Stock",
};

const TYPE_DESC: Record<string, string> = {
  PRICE_GAP: "Your price is significantly higher than a competitor's — consider adjusting.",
  SLOW_MOVER_DISCOUNT: "This product hasn't sold in 45+ days. A discount may help move stock.",
  SEASONAL_STOCK: "AI recommends stocking up based on seasonal demand patterns.",
};

export default function AIAlertsPage() {
  const [recs, setRecs] = useState<Recommendation[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>("PENDING");
  const [acting, setActing] = useState<string | null>(null);

  const load = useCallback(async () => {
    const token = localStorage.getItem("mwalimu_token");
    if (!token) return;
    setLoading(true);
    try {
      const res = await fetch(`${apiBase}/ai/recommendations`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      if (res.ok) {
        const data = await res.json();
        setRecs(data.data ?? []);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function act(id: string, action: "approve" | "dismiss") {
    const token = localStorage.getItem("mwalimu_token");
    if (!token) return;
    setActing(id);
    try {
      await fetch(`${apiBase}/ai/recommendations/${id}/${action}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      await load();
    } finally {
      setActing(null);
    }
  }

  const displayed = filter === "ALL" ? recs : recs.filter((r) => r.status === filter);
  const pendingCount = recs.filter((r) => r.status === "PENDING").length;

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "1rem" }}>
        <h1 style={{ margin: 0, fontSize: "1.35rem", fontWeight: 800, letterSpacing: "-0.02em" }}>AI Alerts</h1>
        {pendingCount > 0 && <span className="chip chip-yellow">{pendingCount} pending</span>}
      </div>
      <p className="muted" style={{ marginBottom: "1rem" }}>AI-generated recommendations for pricing, slow movers, and seasonal stocking. Approve or dismiss each alert.</p>

      <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1.25rem", flexWrap: "wrap" }}>
        {["PENDING", "APPROVED", "DISMISSED", "ALL"].map((s) => (
          <button key={s} className={`filter-chip ${filter === s ? "active" : ""}`} onClick={() => setFilter(s)}>
            {s}
          </button>
        ))}
        <button className="button ghost" style={{ marginLeft: "auto", fontSize: "0.82rem" }} onClick={load}>↻</button>
      </div>

      {loading ? (
        <div style={{ color: "var(--muted)", textAlign: "center", padding: "3rem" }}>Loading recommendations…</div>
      ) : displayed.length === 0 ? (
        <div className="card" style={{ textAlign: "center", padding: "3rem", color: "var(--muted)" }}>
          No {filter === "ALL" ? "" : filter.toLowerCase()} recommendations.
        </div>
      ) : (
        <div style={{ display: "grid", gap: "0.75rem" }}>
          {displayed.map((rec) => (
            <div key={rec.id} className="card" style={{ display: "grid", gap: "0.5rem" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "0.5rem" }}>
                <div>
                  <span className="chip chip-blue" style={{ marginRight: "0.5rem" }}>{TYPE_LABELS[rec.type] ?? rec.type}</span>
                  <span className={`chip ${rec.status === "PENDING" ? "chip-yellow" : rec.status === "APPROVED" ? "chip-green" : rec.status === "DISMISSED" ? "chip-gray" : "chip-blue"}`}>
                    {rec.status}
                  </span>
                </div>
                <span style={{ fontSize: "0.8rem", color: "var(--muted)" }}>
                  {new Date(rec.createdAt).toLocaleDateString("en-KE", { day: "numeric", month: "short", year: "numeric" })}
                </span>
              </div>

              {rec.product && (
                <div style={{ fontWeight: 700 }}>{rec.product.name} <span style={{ color: "var(--muted)", fontWeight: 400, fontSize: "0.85rem" }}>({rec.product.sku})</span></div>
              )}

              <p className="muted" style={{ margin: 0, fontSize: "0.88rem" }}>{TYPE_DESC[rec.type]}</p>

              {Object.keys(rec.payload).length > 0 && (
                <div style={{ background: "#f8fafc", border: "1px solid var(--border)", borderRadius: "8px", padding: "0.65rem", fontSize: "0.84rem" }}>
                  {Object.entries(rec.payload).map(([k, v]) => (
                    <div key={k} style={{ display: "flex", justifyContent: "space-between", padding: "0.15rem 0" }}>
                      <span style={{ color: "var(--muted)" }}>{k.replace(/_/g, " ")}</span>
                      <span style={{ fontWeight: 700 }}>{String(v)}</span>
                    </div>
                  ))}
                </div>
              )}

              {rec.status === "PENDING" && (
                <div style={{ display: "flex", gap: "0.5rem" }}>
                  <button
                    className="button"
                    style={{ padding: "0.45rem 0.9rem", fontSize: "0.88rem" }}
                    onClick={() => act(rec.id, "approve")}
                    disabled={acting === rec.id}
                  >
                    Approve
                  </button>
                  <button
                    className="button ghost"
                    style={{ padding: "0.45rem 0.9rem", fontSize: "0.88rem", color: "#dc2626" }}
                    onClick={() => act(rec.id, "dismiss")}
                    disabled={acting === rec.id}
                  >
                    Dismiss
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
