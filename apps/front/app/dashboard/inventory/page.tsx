"use client";

import { useCallback, useEffect, useState } from "react";

const apiBase = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

type StockItem = { id: string; name: string; sku: string; stockQty: number; cost: number; price: number; imageUrl?: string | null };
type Movement = { id: string; delta: number; reason: string; createdAt: string; product: { name: string; sku: string } };

function fmt(n: number) {
  return new Intl.NumberFormat("en-KE", { style: "currency", currency: "KES", maximumFractionDigits: 0 }).format(n);
}

export default function InventoryPage() {
  const [stock, setStock] = useState<StockItem[]>([]);
  const [movements, setMovements] = useState<Movement[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"stock" | "movements" | "adjust">("stock");
  const [query, setQuery] = useState("");

  // Adjust form
  const [adjProductId, setAdjProductId] = useState("");
  const [adjDelta, setAdjDelta] = useState("");
  const [adjReason, setAdjReason] = useState("");
  const [adjSaving, setAdjSaving] = useState(false);
  const [adjMsg, setAdjMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  const load = useCallback(async () => {
    const token = localStorage.getItem("mwalimu_token");
    if (!token) return;
    setLoading(true);
    try {
      const h = { Authorization: `Bearer ${token}` };
      const [sRes, mRes] = await Promise.all([
        fetch(`${apiBase}/inventory/stock`, { headers: h, cache: "no-store" }),
        fetch(`${apiBase}/inventory/movements?take=100`, { headers: h, cache: "no-store" }),
      ]);
      if (sRes.ok) setStock((await sRes.json()).data ?? []);
      if (mRes.ok) setMovements((await mRes.json()).data ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function submitAdjust(e: React.FormEvent) {
    e.preventDefault();
    const token = localStorage.getItem("mwalimu_token");
    if (!token || !adjProductId || !adjDelta || !adjReason) return;
    setAdjSaving(true);
    setAdjMsg(null);
    try {
      const res = await fetch(`${apiBase}/inventory/adjust`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ productId: adjProductId, delta: parseInt(adjDelta), reason: adjReason }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error ?? "Adjustment failed");
      setAdjMsg({ type: "ok", text: "Stock adjusted." });
      setAdjProductId(""); setAdjDelta(""); setAdjReason("");
      load();
    } catch (err: any) {
      setAdjMsg({ type: "err", text: err?.message ?? "Failed" });
    } finally {
      setAdjSaving(false);
    }
  }

  const q = query.trim().toLowerCase();
  const displayedStock = q ? stock.filter((s) => s.name.toLowerCase().includes(q) || s.sku.toLowerCase().includes(q)) : stock;
  const lowStock = stock.filter((s) => s.stockQty > 0 && s.stockQty <= 5).length;
  const outOfStock = stock.filter((s) => s.stockQty <= 0).length;
  const stockValue = stock.reduce((sum, s) => sum + s.stockQty * s.cost, 0);

  return (
    <div>
      <h1 style={{ margin: "0 0 0.75rem", fontSize: "1.35rem", fontWeight: 800, letterSpacing: "-0.02em" }}>Inventory</h1>

      <div className="stat-grid" style={{ marginBottom: "1.25rem" }}>
        <div className="stat-card"><div className="stat-label">Total SKUs</div><div className="stat-value">{stock.length}</div></div>
        <div className="stat-card"><div className="stat-label">Stock value (cost)</div><div className="stat-value">{fmt(stockValue)}</div></div>
        <div className="stat-card"><div className="stat-label">Low stock (≤5)</div><div className="stat-value" style={{ color: lowStock > 0 ? "#d97706" : undefined }}>{lowStock}</div></div>
        <div className="stat-card"><div className="stat-label">Out of stock</div><div className="stat-value" style={{ color: outOfStock > 0 ? "#dc2626" : undefined }}>{outOfStock}</div></div>
      </div>

      <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1rem" }}>
        {(["stock", "movements", "adjust"] as const).map((t) => (
          <button key={t} className={`filter-chip ${tab === t ? "active" : ""}`} onClick={() => setTab(t)}>
            {t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
        <button className="button ghost" style={{ marginLeft: "auto", fontSize: "0.82rem" }} onClick={load}>↻</button>
      </div>

      {tab === "stock" && (
        <>
          <input className="pos-search-input" style={{ marginBottom: "1rem", maxWidth: "340px", display: "block" }} placeholder="Search by name or SKU…" value={query} onChange={(e) => setQuery(e.target.value)} />
          {loading ? <div style={{ color: "var(--muted)" }}>Loading…</div> : (
            <div className="table-wrap">
              <table className="data-table">
                <thead><tr><th>Product</th><th>SKU</th><th>Stock</th><th>Cost</th><th>Price</th><th>Stock value</th></tr></thead>
                <tbody>
                  {displayedStock.map((s) => (
                    <tr key={s.id}>
                      <td style={{ fontWeight: 700 }}>{s.name}</td>
                      <td style={{ fontFamily: "monospace", fontSize: "0.85rem" }}>{s.sku}</td>
                      <td>
                        <span className={`chip ${s.stockQty <= 0 ? "chip-red" : s.stockQty <= 5 ? "chip-yellow" : "chip-green"}`}>
                          {s.stockQty}
                        </span>
                      </td>
                      <td style={{ fontSize: "0.88rem" }}>{fmt(s.cost)}</td>
                      <td style={{ fontSize: "0.88rem" }}>{fmt(s.price)}</td>
                      <td style={{ fontWeight: 700 }}>{fmt(s.stockQty * s.cost)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {tab === "movements" && (
        <div className="table-wrap">
          <table className="data-table">
            <thead><tr><th>Date</th><th>Product</th><th>SKU</th><th>Delta</th><th>Reason</th></tr></thead>
            <tbody>
              {movements.length === 0 && <tr><td colSpan={5} style={{ textAlign: "center", color: "var(--muted)" }}>No movements yet.</td></tr>}
              {movements.map((m) => (
                <tr key={m.id}>
                  <td style={{ fontSize: "0.82rem", color: "var(--muted)" }}>{new Date(m.createdAt).toLocaleDateString("en-KE", { day: "numeric", month: "short", year: "numeric" })}</td>
                  <td style={{ fontWeight: 700 }}>{m.product.name}</td>
                  <td style={{ fontFamily: "monospace", fontSize: "0.82rem" }}>{m.product.sku}</td>
                  <td>
                    <span className={`chip ${m.delta > 0 ? "chip-green" : "chip-red"}`}>
                      {m.delta > 0 ? "+" : ""}{m.delta}
                    </span>
                  </td>
                  <td style={{ fontSize: "0.85rem" }}>{m.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === "adjust" && (
        <div className="card" style={{ maxWidth: "420px" }}>
          <h3 style={{ margin: "0 0 0.75rem" }}>Manual stock adjustment</h3>
          <form onSubmit={submitAdjust} style={{ display: "grid", gap: "0.65rem" }}>
            <label className="input-group">
              <span>Product</span>
              <select value={adjProductId} onChange={(e) => setAdjProductId(e.target.value)} required>
                <option value="">Select product</option>
                {stock.map((s) => <option key={s.id} value={s.id}>{s.name} — {s.sku} (stock: {s.stockQty})</option>)}
              </select>
            </label>
            <label className="input-group">
              <span>Quantity change (positive = add, negative = remove)</span>
              <input type="number" value={adjDelta} onChange={(e) => setAdjDelta(e.target.value)} placeholder="e.g. 10 or -3" required />
            </label>
            <label className="input-group">
              <span>Reason</span>
              <input value={adjReason} onChange={(e) => setAdjReason(e.target.value)} placeholder="e.g. Damaged goods, Recount" required />
            </label>
            {adjMsg && <div className={adjMsg.type === "ok" ? "signin-success" : "signin-error"}>{adjMsg.text}</div>}
            <button className="button" type="submit" disabled={adjSaving}>{adjSaving ? "Saving…" : "Apply adjustment"}</button>
          </form>
        </div>
      )}
    </div>
  );
}
