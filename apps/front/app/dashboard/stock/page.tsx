"use client";

import { useEffect, useRef, useState } from "react";

const apiBase = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

type Product = { id: string; sku: string; name: string; price: number; stockQty: number; category: string };
type GrnLine = { sku: string; name: string; qty: number; costPrice: number };
type Change  = { id: string; type: string; payload: any; status: string; createdAt: string; appliedAt: string | null; failReason: string | null };

const ADJUST_REASONS = [
  "Count Correction",
  "Damaged / Write-off",
  "Expiry / Disposal",
  "Theft / Shortage",
  "Transfer In",
  "Transfer Out",
  "Other",
];

function fmt(n: number) {
  return "KES " + (n ?? 0).toLocaleString("en-KE", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

function StatusBadge({ status }: { status: string }) {
  const color = status === "applied" ? "#16a34a" : status === "failed" ? "#dc2626" : "#d97706";
  const label = status === "applied" ? "Applied" : status === "failed" ? "Failed" : "Pending…";
  return <span style={{ fontSize: "0.75rem", fontWeight: 700, color, background: `${color}18`, padding: "0.15rem 0.5rem", borderRadius: 99 }}>{label}</span>;
}

// ── Shared product search component ──────────────────────────
function ProductSearch({ onSelect, placeholder = "Search product name or SKU…" }: {
  onSelect: (p: Product) => void;
  placeholder?: string;
}) {
  const [q, setQ]           = useState("");
  const [results, setResults] = useState<Product[]>([]);
  const [open, setOpen]     = useState(false);
  const token                = typeof window !== "undefined" ? localStorage.getItem("mwalimu_token") ?? "" : "";
  const timer                = useRef<ReturnType<typeof setTimeout> | null>(null);

  function search(val: string) {
    setQ(val);
    if (timer.current) clearTimeout(timer.current);
    if (val.length < 2) { setResults([]); setOpen(false); return; }
    timer.current = setTimeout(async () => {
      const r = await fetch(`${apiBase}/products/search?q=${encodeURIComponent(val)}`, {
        headers: { Authorization: `Bearer ${token}` },
      }).then(r => r.json()).catch(() => []);
      setResults(r);
      setOpen(true);
    }, 250);
  }

  function pick(p: Product) {
    setQ(p.name);
    setOpen(false);
    onSelect(p);
  }

  return (
    <div style={{ position: "relative" }}>
      <input className="input-field" value={q} onChange={e => search(e.target.value)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder={placeholder} autoComplete="off" />
      {open && results.length > 0 && (
        <div style={{ position: "absolute", top: "100%", left: 0, right: 0, background: "#fff", border: "1px solid var(--border)", borderRadius: 10, zIndex: 50, maxHeight: 260, overflowY: "auto", boxShadow: "0 4px 12px rgba(0,0,0,0.1)" }}>
          {results.map(p => (
            <div key={p.id} onMouseDown={() => pick(p)}
              style={{ padding: "0.6rem 0.75rem", cursor: "pointer", borderBottom: "1px solid #f3f4f6" }}
              onMouseEnter={e => (e.currentTarget.style.background = "#f9fafb")}
              onMouseLeave={e => (e.currentTarget.style.background = "")}>
              <div style={{ fontWeight: 600, fontSize: "0.9rem" }}>{p.name}</div>
              <div style={{ fontSize: "0.78rem", color: "var(--muted)" }}>
                {p.sku} &middot; Stock: <strong>{p.stockQty}</strong> &middot; {fmt(p.price)}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Tab 1: Stock Adjustment ───────────────────────────────────
function AdjustTab({ token }: { token: string }) {
  const [product, setProduct] = useState<Product | null>(null);
  const [delta, setDelta]     = useState("");
  const [reason, setReason]   = useState(ADJUST_REASONS[0]);
  const [busy, setBusy]       = useState(false);
  const [msg, setMsg]         = useState<{ ok: boolean; text: string } | null>(null);

  async function submit() {
    if (!product || !delta || Number(delta) === 0) return;
    setBusy(true); setMsg(null);
    try {
      const r = await fetch(`${apiBase}/sync/pending-changes`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          type: "stock_adjustment",
          payload: { sku: product.sku, name: product.name, delta: Number(delta), reason },
        }),
      });
      if (r.ok) {
        setMsg({ ok: true, text: `Adjustment queued — will apply to MySQL within 30 seconds on next refresh.` });
        setProduct(null); setDelta(""); setReason(ADJUST_REASONS[0]);
      } else {
        setMsg({ ok: false, text: "Failed to queue adjustment." });
      }
    } catch { setMsg({ ok: false, text: "Network error." }); }
    setBusy(false);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem", maxWidth: 520 }}>
      <div>
        <label className="input-label">Search Product</label>
        <ProductSearch onSelect={p => { setProduct(p); setDelta(""); }} />
      </div>

      {product && (
        <div className="card" style={{ padding: "0.75rem 1rem", background: "#f0fdf4", border: "1px solid #86efac" }}>
          <div style={{ fontWeight: 700 }}>{product.name}</div>
          <div style={{ fontSize: "0.82rem", color: "var(--muted)", marginTop: 2 }}>
            SKU: {product.sku} &middot; Category: {product.category}
          </div>
          <div style={{ marginTop: "0.5rem", display: "flex", gap: "1.5rem" }}>
            <span>Current stock: <strong>{product.stockQty} units</strong></span>
            <span>Price: <strong>{fmt(product.price)}</strong></span>
          </div>
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
        <div>
          <label className="input-label">Adjustment Qty</label>
          <input className="input-field" type="number" value={delta}
            onChange={e => setDelta(e.target.value)}
            placeholder="e.g. +50 or -10"
            disabled={!product} />
          {product && delta && Number(delta) !== 0 && (
            <div style={{ fontSize: "0.78rem", marginTop: 4, color: Number(delta) > 0 ? "#16a34a" : "#dc2626" }}>
              New stock: {product.stockQty + Number(delta)} units
            </div>
          )}
        </div>
        <div>
          <label className="input-label">Reason</label>
          <select className="input-field" value={reason} onChange={e => setReason(e.target.value)} disabled={!product}>
            {ADJUST_REASONS.map(r => <option key={r}>{r}</option>)}
          </select>
        </div>
      </div>

      <button className="button" disabled={!product || !delta || Number(delta) === 0 || busy}
        onClick={submit}>
        {busy ? "Queuing…" : "Submit Adjustment"}
      </button>

      {msg && (
        <div style={{ padding: "0.65rem 0.75rem", borderRadius: 10, fontWeight: 600,
          background: msg.ok ? "#f0fdf4" : "#fef2f2",
          border: `1px solid ${msg.ok ? "#86efac" : "#fca5a5"}`,
          color: msg.ok ? "#166534" : "#991b1b" }}>
          {msg.text}
        </div>
      )}
    </div>
  );
}

// ── Tab 2: Goods Received (GRN) ───────────────────────────────
function GrnTab({ token }: { token: string }) {
  const [supplier, setSupplier] = useState("");
  const [lines, setLines]       = useState<GrnLine[]>([]);
  const [busy, setBusy]         = useState(false);
  const [msg, setMsg]           = useState<{ ok: boolean; text: string } | null>(null);

  const total = lines.reduce((s, l) => s + l.qty * l.costPrice, 0);

  function addLine(p: Product) {
    setLines(prev => {
      const existing = prev.findIndex(l => l.sku === p.sku);
      if (existing >= 0) return prev; // already in list
      return [...prev, { sku: p.sku, name: p.name, qty: 1, costPrice: 0 }];
    });
  }

  function updateLine(i: number, field: keyof GrnLine, val: string) {
    setLines(prev => prev.map((l, idx) => idx === i ? { ...l, [field]: field === "sku" || field === "name" ? val : Number(val) } : l));
  }

  function removeLine(i: number) {
    setLines(prev => prev.filter((_, idx) => idx !== i));
  }

  async function submit() {
    if (!supplier.trim() || lines.length === 0) return;
    if (lines.some(l => l.qty <= 0 || l.costPrice <= 0)) {
      setMsg({ ok: false, text: "All lines must have qty > 0 and cost price > 0." });
      return;
    }
    setBusy(true); setMsg(null);
    try {
      const r = await fetch(`${apiBase}/sync/pending-changes`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          type: "goods_received",
          payload: { supplierName: supplier.trim(), lines },
        }),
      });
      if (r.ok) {
        setMsg({ ok: true, text: `GRN queued (${lines.length} lines, ${fmt(total)}) — will post to MySQL on next refresh.` });
        setSupplier(""); setLines([]);
      } else {
        setMsg({ ok: false, text: "Failed to queue GRN." });
      }
    } catch { setMsg({ ok: false, text: "Network error." }); }
    setBusy(false);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      <div style={{ maxWidth: 400 }}>
        <label className="input-label">Supplier Name</label>
        <input className="input-field" value={supplier} onChange={e => setSupplier(e.target.value)}
          placeholder="e.g. Unilever Kenya Ltd" />
      </div>

      <div>
        <label className="input-label">Add Product</label>
        <div style={{ maxWidth: 520 }}>
          <ProductSearch onSelect={addLine} placeholder="Search and add product lines…" />
        </div>
      </div>

      {lines.length > 0 && (
        <div className="card" style={{ padding: 0, overflow: "hidden" }}>
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Product</th>
                  <th style={{ width: 90 }}>Qty</th>
                  <th style={{ width: 130 }}>Cost / unit</th>
                  <th style={{ width: 120 }}>Subtotal</th>
                  <th style={{ width: 40 }}></th>
                </tr>
              </thead>
              <tbody>
                {lines.map((line, i) => (
                  <tr key={line.sku}>
                    <td>
                      <div style={{ fontWeight: 600 }}>{line.name}</div>
                      <div style={{ fontSize: "0.75rem", color: "var(--muted)" }}>{line.sku}</div>
                    </td>
                    <td>
                      <input type="number" value={line.qty} min={1}
                        onChange={e => updateLine(i, "qty", e.target.value)}
                        style={{ width: 70, border: "1px solid var(--border)", borderRadius: 6, padding: "0.3rem 0.5rem" }} />
                    </td>
                    <td>
                      <input type="number" value={line.costPrice || ""} min={0} step={0.01}
                        onChange={e => updateLine(i, "costPrice", e.target.value)}
                        placeholder="0.00"
                        style={{ width: 110, border: "1px solid var(--border)", borderRadius: 6, padding: "0.3rem 0.5rem" }} />
                    </td>
                    <td style={{ fontWeight: 600 }}>
                      {line.costPrice > 0 ? fmt(line.qty * line.costPrice) : "—"}
                    </td>
                    <td>
                      <button onClick={() => removeLine(i)}
                        style={{ background: "none", border: "none", cursor: "pointer", color: "#dc2626", fontSize: "1.1rem", lineHeight: 1 }}>
                        ×
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={3} style={{ textAlign: "right", fontWeight: 700, padding: "0.65rem 0.75rem" }}>Total</td>
                  <td style={{ fontWeight: 800, color: "var(--teal)" }}>{fmt(total)}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}

      {lines.length === 0 && (
        <div className="muted" style={{ padding: "1.5rem", textAlign: "center", border: "2px dashed var(--border)", borderRadius: 10 }}>
          Search for products above to add lines to this GRN
        </div>
      )}

      <div style={{ display: "flex", gap: "0.75rem", alignItems: "center" }}>
        <button className="button" disabled={!supplier.trim() || lines.length === 0 || busy} onClick={submit}>
          {busy ? "Queuing…" : `Post GRN (${fmt(total)})`}
        </button>
        {lines.length > 0 && (
          <span className="muted" style={{ fontSize: "0.82rem" }}>
            {lines.length} line{lines.length !== 1 ? "s" : ""} · will create GRN WEB###### in POS
          </span>
        )}
      </div>

      {msg && (
        <div style={{ padding: "0.65rem 0.75rem", borderRadius: 10, fontWeight: 600,
          background: msg.ok ? "#f0fdf4" : "#fef2f2",
          border: `1px solid ${msg.ok ? "#86efac" : "#fca5a5"}`,
          color: msg.ok ? "#166534" : "#991b1b" }}>
          {msg.text}
        </div>
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────
export default function StockPage() {
  const [tab, setTab]       = useState<"adjust" | "grn">("adjust");
  const [token, setToken]   = useState("");
  const [history, setHistory] = useState<Change[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const tokenRef = useRef("");

  useEffect(() => {
    const t = localStorage.getItem("mwalimu_token") ?? "";
    setToken(t); tokenRef.current = t;
    loadHistory(t);
  }, []);

  async function loadHistory(t: string) {
    setLoadingHistory(true);
    const r = await fetch(`${apiBase}/sync/pending-changes/history`, {
      headers: { Authorization: `Bearer ${t}` },
    }).then(r => r.json()).catch(() => []);
    setHistory(Array.isArray(r) ? r.filter((c: Change) => c.type === "stock_adjustment" || c.type === "goods_received") : []);
    setLoadingHistory(false);
  }

  if (!token) return null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
      <div>
        <h2 style={{ margin: 0, fontWeight: 800, letterSpacing: "-0.02em" }}>Stock Management</h2>
        <p className="muted" style={{ margin: "0.2rem 0 0", fontSize: "0.85rem" }}>
          Adjustments and GRNs queue here and are applied to MySQL within 30 seconds of the next dashboard refresh.
        </p>
      </div>

      {/* Tab selector */}
      <div style={{ display: "flex", gap: "0.5rem", borderBottom: "1px solid var(--border)", paddingBottom: "0.5rem" }}>
        {(["adjust", "grn"] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            style={{ border: "none", cursor: "pointer", fontFamily: "inherit",
              padding: "0.4rem 0.9rem", borderRadius: 8, fontWeight: tab === t ? 700 : 400,
              color: tab === t ? "var(--teal)" : "var(--muted)",
              background: tab === t ? "#f0fdf4" : "none" } as any}>
            {t === "adjust" ? "Adjust Stock" : "Receive Goods (GRN)"}
          </button>
        ))}
      </div>

      {/* Active tab */}
      <div className="card">
        {tab === "adjust" ? <AdjustTab token={token} /> : <GrnTab token={token} />}
      </div>

      {/* Recent changes */}
      <div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.75rem" }}>
          <h3 style={{ margin: 0, fontSize: "0.95rem", fontWeight: 700 }}>Recent Changes</h3>
          <button className="button ghost" style={{ fontSize: "0.8rem", padding: "0.25rem 0.65rem" }}
            onClick={() => loadHistory(tokenRef.current)}>
            ↺ Reload
          </button>
        </div>
        {loadingHistory ? (
          <p className="muted">Loading…</p>
        ) : history.length === 0 ? (
          <p className="muted">No stock changes yet.</p>
        ) : (
          <div className="card" style={{ padding: 0, overflow: "hidden" }}>
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr><th>Type</th><th>Details</th><th>Status</th><th>Time</th></tr>
                </thead>
                <tbody>
                  {history.map(c => (
                    <tr key={c.id}>
                      <td>
                        <span style={{ fontWeight: 700, fontSize: "0.8rem",
                          color: c.type === "goods_received" ? "#0f5ba7" : "#7c3aed" }}>
                          {c.type === "goods_received" ? "GRN" : "Adjustment"}
                        </span>
                      </td>
                      <td style={{ fontSize: "0.85rem" }}>
                        {c.type === "stock_adjustment" ? (
                          <>
                            <strong>{c.payload.name || c.payload.sku}</strong>
                            {" "}{Number(c.payload.delta) > 0 ? "+" : ""}{c.payload.delta} units
                            {c.payload.reason ? <span className="muted"> · {c.payload.reason}</span> : null}
                          </>
                        ) : (
                          <>
                            <strong>{c.payload.supplierName}</strong>
                            {" · "}{c.payload.lines?.length ?? 0} line(s)
                            {" · "}{fmt(c.payload.lines?.reduce((s: number, l: GrnLine) => s + l.qty * l.costPrice, 0) ?? 0)}
                          </>
                        )}
                        {c.failReason && <div style={{ color: "#dc2626", fontSize: "0.75rem" }}>{c.failReason}</div>}
                      </td>
                      <td><StatusBadge status={c.status} /></td>
                      <td className="muted" style={{ fontSize: "0.8rem", whiteSpace: "nowrap" }}>
                        {new Date(c.createdAt).toLocaleString("en-KE", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                      </td>
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
