"use client";

import { useCallback, useEffect, useState } from "react";

const apiBase = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

type Supplier = { id: string; name: string; email?: string | null; phone?: string | null };
type StockProduct = { id: string; name: string; sku: string; stockQty: number; cost: number };
type PurchaseItem = { productId: string; qty: number; cost: number };
type Purchase = {
  id: string;
  totalCost: number;
  notes?: string | null;
  createdAt: string;
  supplier: { name: string };
  items: { qty: number; cost: number; product: { name: string; sku: string } }[];
};

function fmt(n: number) {
  return new Intl.NumberFormat("en-KE", { style: "currency", currency: "KES", maximumFractionDigits: 0 }).format(n);
}

export default function PurchasesPage() {
  const [tab, setTab] = useState<"purchases" | "suppliers">("purchases");
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [products, setProducts] = useState<StockProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  // New purchase form
  const [supplierId, setSupplierId] = useState("");
  const [notes, setNotes] = useState("");
  const [items, setItems] = useState<PurchaseItem[]>([{ productId: "", qty: 1, cost: 0 }]);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveOk, setSaveOk] = useState<string | null>(null);

  // New supplier form
  const [supName, setSupName] = useState("");
  const [supEmail, setSupEmail] = useState("");
  const [supPhone, setSupPhone] = useState("");
  const [supSaving, setSupSaving] = useState(false);

  const load = useCallback(async () => {
    const token = localStorage.getItem("mwalimu_token");
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const h = { Authorization: `Bearer ${token}` };
      const [pRes, sRes, prRes] = await Promise.all([
        fetch(`${apiBase}/purchases`, { headers: h, cache: "no-store" }),
        fetch(`${apiBase}/suppliers`, { headers: h, cache: "no-store" }),
        fetch(`${apiBase}/inventory/stock`, { headers: h, cache: "no-store" }),
      ]);
      if (pRes.ok) setPurchases((await pRes.json()).data ?? []);
      if (sRes.ok) setSuppliers((await sRes.json()).data ?? []);
      if (prRes.ok) setProducts((await prRes.json()).data ?? []);
    } catch {
      setError("Failed to load data");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  function addItem() { setItems((prev) => [...prev, { productId: "", qty: 1, cost: 0 }]); }
  function removeItem(i: number) { setItems((prev) => prev.filter((_, idx) => idx !== i)); }
  function updateItem(i: number, field: keyof PurchaseItem, val: string | number) {
    setItems((prev) => prev.map((item, idx) => idx === i ? { ...item, [field]: val } : item));
  }

  async function submitPurchase(e: React.FormEvent) {
    e.preventDefault();
    const token = localStorage.getItem("mwalimu_token");
    if (!token || !supplierId) return;
    setSaving(true);
    setSaveError(null);
    setSaveOk(null);
    try {
      const res = await fetch(`${apiBase}/purchases`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ supplierId, notes: notes || undefined, items }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error ?? "Failed to create purchase");
      setSaveOk("Purchase recorded and stock updated.");
      setSupplierId(""); setNotes(""); setItems([{ productId: "", qty: 1, cost: 0 }]);
      load();
    } catch (err: any) {
      setSaveError(err?.message ?? "Failed");
    } finally {
      setSaving(false);
    }
  }

  async function addSupplier(e: React.FormEvent) {
    e.preventDefault();
    const token = localStorage.getItem("mwalimu_token");
    if (!token || !supName) return;
    setSupSaving(true);
    try {
      const res = await fetch(`${apiBase}/suppliers`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ name: supName, email: supEmail || undefined, phone: supPhone || undefined }),
      });
      if (!res.ok) throw new Error("Failed to add supplier");
      setSupName(""); setSupEmail(""); setSupPhone("");
      load();
    } catch (err: any) {
      alert(err?.message ?? "Failed");
    } finally {
      setSupSaving(false);
    }
  }

  return (
    <div>
      <h1 style={{ margin: "0 0 1rem", fontSize: "1.35rem", fontWeight: 800, letterSpacing: "-0.02em" }}>Purchases & Suppliers</h1>

      <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1.25rem" }}>
        {(["purchases", "suppliers"] as const).map((t) => (
          <button key={t} className={`filter-chip ${tab === t ? "active" : ""}`} onClick={() => setTab(t)}>
            {t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      {error && <div className="signin-error" style={{ marginBottom: "1rem" }}>{error}</div>}

      {tab === "purchases" && (
        <div style={{ display: "grid", gridTemplateColumns: "minmax(300px, 420px) 1fr", gap: "1.5rem", alignItems: "start" }}>
          {/* Form */}
          <div className="card">
            <h3 style={{ margin: "0 0 0.75rem" }}>Record a purchase</h3>
            <form onSubmit={submitPurchase} style={{ display: "grid", gap: "0.75rem" }}>
              <label className="input-group">
                <span>Supplier</span>
                <select value={supplierId} onChange={(e) => setSupplierId(e.target.value)} required>
                  <option value="">Select supplier</option>
                  {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </label>
              <label className="input-group">
                <span>Notes</span>
                <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Invoice #, batch, etc." />
              </label>
              <div>
                <div style={{ fontWeight: 700, fontSize: "0.85rem", marginBottom: "0.4rem" }}>Items</div>
                {items.map((item, i) => (
                  <div key={i} style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr auto", gap: "0.4rem", marginBottom: "0.4rem", alignItems: "end" }}>
                    <label className="input-group">
                      {i === 0 && <span>Product</span>}
                      <select value={item.productId} onChange={(e) => updateItem(i, "productId", e.target.value)} required>
                        <option value="">Pick product</option>
                        {products.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.sku})</option>)}
                      </select>
                    </label>
                    <label className="input-group">
                      {i === 0 && <span>Qty</span>}
                      <input type="number" min="1" value={item.qty} onChange={(e) => updateItem(i, "qty", parseInt(e.target.value) || 1)} required />
                    </label>
                    <label className="input-group">
                      {i === 0 && <span>Unit cost</span>}
                      <input type="number" min="0" step="0.01" value={item.cost || ""} onChange={(e) => updateItem(i, "cost", parseFloat(e.target.value) || 0)} required />
                    </label>
                    <button type="button" className="button ghost" style={{ padding: "0.45rem 0.6rem", marginTop: i === 0 ? "1.15rem" : 0 }} onClick={() => removeItem(i)} disabled={items.length === 1}>✕</button>
                  </div>
                ))}
                <button type="button" className="button ghost" style={{ fontSize: "0.85rem" }} onClick={addItem}>+ Add item</button>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 700, paddingTop: "0.5rem", borderTop: "1px solid var(--border)" }}>
                <span>Total cost</span>
                <span>{fmt(items.reduce((s, i) => s + (i.cost || 0) * (i.qty || 0), 0))}</span>
              </div>
              {saveError && <div className="signin-error">{saveError}</div>}
              {saveOk && <div className="signin-success">{saveOk}</div>}
              <button className="button" type="submit" disabled={saving}>{saving ? "Saving…" : "Record purchase & update stock"}</button>
            </form>
          </div>

          {/* History */}
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.75rem" }}>
              <h3 style={{ margin: 0 }}>Purchase history</h3>
              <button className="button ghost" style={{ fontSize: "0.82rem" }} onClick={load}>↻</button>
            </div>
            {loading ? <div style={{ color: "var(--muted)" }}>Loading…</div> : (
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr><th>Date</th><th>Supplier</th><th>Items</th><th>Total cost</th><th>Notes</th></tr>
                  </thead>
                  <tbody>
                    {purchases.length === 0 && <tr><td colSpan={5} style={{ textAlign: "center", color: "var(--muted)" }}>No purchases yet.</td></tr>}
                    {purchases.map((p) => (
                      <>
                        <tr key={p.id} style={{ cursor: "pointer" }} onClick={() => setExpanded(expanded === p.id ? null : p.id)}>
                          <td style={{ fontSize: "0.85rem", color: "var(--muted)" }}>{new Date(p.createdAt).toLocaleDateString("en-KE", { day: "numeric", month: "short", year: "numeric" })}</td>
                          <td style={{ fontWeight: 700 }}>{p.supplier.name}</td>
                          <td>{p.items.length}</td>
                          <td style={{ fontWeight: 700 }}>{fmt(Number(p.totalCost))}</td>
                          <td style={{ fontSize: "0.83rem", color: "var(--muted)" }}>{p.notes ?? "—"}</td>
                        </tr>
                        {expanded === p.id && (
                          <tr key={`${p.id}-d`}>
                            <td colSpan={5} style={{ background: "#f8fafc", padding: "0.75rem" }}>
                              {p.items.map((item, i) => (
                                <div key={i} style={{ display: "flex", justifyContent: "space-between", fontSize: "0.85rem", padding: "0.2rem 0", borderBottom: "1px solid var(--border)" }}>
                                  <span>{item.product.name} ({item.product.sku}) × {item.qty}</span>
                                  <span style={{ fontWeight: 700 }}>{fmt(item.cost * item.qty)}</span>
                                </div>
                              ))}
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
        </div>
      )}

      {tab === "suppliers" && (
        <div style={{ display: "grid", gridTemplateColumns: "minmax(280px, 360px) 1fr", gap: "1.5rem", alignItems: "start" }}>
          <div className="card">
            <h3 style={{ margin: "0 0 0.75rem" }}>Add supplier</h3>
            <form onSubmit={addSupplier} style={{ display: "grid", gap: "0.65rem" }}>
              <label className="input-group"><span>Name</span><input value={supName} onChange={(e) => setSupName(e.target.value)} required placeholder="Supplier Ltd." /></label>
              <label className="input-group"><span>Email</span><input type="email" value={supEmail} onChange={(e) => setSupEmail(e.target.value)} placeholder="Optional" /></label>
              <label className="input-group"><span>Phone</span><input value={supPhone} onChange={(e) => setSupPhone(e.target.value)} placeholder="Optional" /></label>
              <button className="button" type="submit" disabled={supSaving}>{supSaving ? "Saving…" : "Add supplier"}</button>
            </form>
          </div>
          <div className="table-wrap">
            <table className="data-table">
              <thead><tr><th>Supplier</th><th>Email</th><th>Phone</th></tr></thead>
              <tbody>
                {suppliers.length === 0 && <tr><td colSpan={3} style={{ textAlign: "center", color: "var(--muted)" }}>No suppliers yet.</td></tr>}
                {suppliers.map((s) => (
                  <tr key={s.id}>
                    <td style={{ fontWeight: 700 }}>{s.name}</td>
                    <td style={{ fontSize: "0.88rem" }}>{s.email ?? "—"}</td>
                    <td style={{ fontSize: "0.88rem" }}>{s.phone ?? "—"}</td>
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
