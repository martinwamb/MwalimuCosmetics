"use client";

import { useEffect, useRef, useState } from "react";

const apiBase = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

type Product  = { id: string; sku: string; name: string; price: number; cost: number; wholesalePrice: number | null; specialPrice: number | null; stockQty: number; category: string };
type GrnLine  = { sku: string; name: string; qty: number; costPrice: number };
type Change   = { id: string; type: string; payload: any; status: string; createdAt: string; appliedAt: string | null; failReason: string | null };
type Supplier = { code: string; name: string };
type Grn      = { no: string; ddate: string; scode: string; sname: string; gtotal: number; posted: number; paid: number };

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

// ── Shared supplier search component ───────────────────────────
function SupplierSearch({ onSelect, placeholder = "Search supplier name or code…" }: {
  onSelect: (s: Supplier) => void;
  placeholder?: string;
}) {
  const [q, setQ]             = useState("");
  const [results, setResults] = useState<Supplier[]>([]);
  const [open, setOpen]       = useState(false);
  const token                 = typeof window !== "undefined" ? localStorage.getItem("mwalimu_token") ?? "" : "";
  const timer                 = useRef<ReturnType<typeof setTimeout> | null>(null);

  function search(val: string) {
    setQ(val);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      const r = await fetch(`${apiBase}/sync/mirror/suppliers?search=${encodeURIComponent(val)}`, {
        headers: { Authorization: `Bearer ${token}` },
      }).then(r => r.json()).catch(() => []);
      setResults(Array.isArray(r) ? r : []);
      setOpen(true);
    }, 250);
  }

  function pick(s: Supplier) {
    setQ(s.name);
    setOpen(false);
    onSelect(s);
  }

  return (
    <div style={{ position: "relative" }}>
      <input className="input-field" value={q} onChange={e => search(e.target.value)}
        onFocus={() => { if (!q) search(""); }}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder={placeholder} autoComplete="off" />
      {open && (
        <div style={{ position: "absolute", top: "100%", left: 0, right: 0, background: "#fff", border: "1px solid var(--border)", borderRadius: 10, zIndex: 50, maxHeight: 260, overflowY: "auto", boxShadow: "0 4px 12px rgba(0,0,0,0.1)" }}>
          {results.length > 0 ? results.map(s => (
            <div key={s.code} onMouseDown={() => pick(s)}
              style={{ padding: "0.6rem 0.75rem", cursor: "pointer", borderBottom: "1px solid #f3f4f6" }}
              onMouseEnter={e => (e.currentTarget.style.background = "#f9fafb")}
              onMouseLeave={e => (e.currentTarget.style.background = "")}>
              <div style={{ fontWeight: 600, fontSize: "0.9rem" }}>{s.name}</div>
              <div style={{ fontSize: "0.78rem", color: "var(--muted)" }}>{s.code}</div>
            </div>
          )) : (
            <div style={{ padding: "0.6rem 0.75rem", fontSize: "0.82rem", color: "var(--muted)" }}>
              No suppliers found — supplier list syncs from the shop PC every few hours.
            </div>
          )}
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
          <div style={{ fontWeight: 700, fontSize: "1rem" }}>{product.name}</div>
          <div style={{ fontSize: "0.8rem", color: "var(--muted)", marginTop: 2 }}>
            SKU: {product.sku} &middot; Category: {product.category}
          </div>
          <div style={{ marginTop: "0.6rem", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: "0.4rem 1rem" }}>
            <div><span className="muted" style={{ fontSize: "0.75rem" }}>Stock</span><br /><strong>{product.stockQty} units</strong></div>
            <div><span className="muted" style={{ fontSize: "0.75rem" }}>Retail price</span><br /><strong>{fmt(product.price)}</strong></div>
            {product.wholesalePrice && <div><span className="muted" style={{ fontSize: "0.75rem" }}>Wholesale</span><br /><strong>{fmt(product.wholesalePrice)}</strong></div>}
            {product.specialPrice   && <div><span className="muted" style={{ fontSize: "0.75rem" }}>Special price</span><br /><strong style={{ color: "#dc2626" }}>{fmt(product.specialPrice)}</strong></div>}
            <div><span className="muted" style={{ fontSize: "0.75rem" }}>Cost (last GRN)</span><br /><strong>{product.cost > 0 ? fmt(product.cost) : "—"}</strong></div>
            {product.price > 0 && product.cost > 0 && (
              <div><span className="muted" style={{ fontSize: "0.75rem" }}>Margin</span><br /><strong style={{ color: "#16a34a" }}>{Math.round((product.price - product.cost) / product.price * 100)}%</strong></div>
            )}
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
  const [supplier, setSupplier]         = useState<Supplier | null>(null);
  const [supplierText, setSupplierText] = useState(""); // fallback free-text if not in su yet
  const [lines, setLines]               = useState<GrnLine[]>([]);
  const [busy, setBusy]                 = useState(false);
  const [msg, setMsg]                   = useState<{ ok: boolean; text: string } | null>(null);

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

  const supplierName = supplier?.name || supplierText.trim();

  async function submit() {
    if (!supplierName || lines.length === 0) return;
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
          payload: { supplierName, supplierCode: supplier?.code, lines },
        }),
      });
      if (r.ok) {
        setMsg({ ok: true, text: `GRN queued (${lines.length} lines, ${fmt(total)}) — will post to MySQL on next refresh.` });
        setSupplier(null); setSupplierText(""); setLines([]);
      } else {
        setMsg({ ok: false, text: "Failed to queue GRN." });
      }
    } catch { setMsg({ ok: false, text: "Network error." }); }
    setBusy(false);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      <div style={{ maxWidth: 400 }}>
        <label className="input-label">Supplier</label>
        <SupplierSearch onSelect={s => { setSupplier(s); setSupplierText(""); }} />
        {!supplier && (
          <div style={{ marginTop: "0.4rem" }}>
            <input className="input-field" value={supplierText}
              onChange={e => { setSupplierText(e.target.value); setSupplier(null); }}
              placeholder="Not in supplier list? Type a name instead (won't link to accounts payable)" />
          </div>
        )}
        {supplier && (
          <div className="muted" style={{ fontSize: "0.78rem", marginTop: 4 }}>
            Linked to supplier <strong>{supplier.code}</strong> — payments against this GRN can post to accounts payable.
          </div>
        )}
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
        <button className="button" disabled={!supplierName || lines.length === 0 || busy} onClick={submit}>
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

// ── Tab 3: GRN Payments (cash / cheque / bank transfer instalments) ──
const PAY_METHODS = ["CASH", "CHEQUE", "BANK"] as const;
type PayMethod = typeof PAY_METHODS[number];

function GrnPaymentsTab({ token }: { token: string }) {
  const [search, setSearch]         = useState("");
  const [grns, setGrns]             = useState<Grn[]>([]);
  const [loading, setLoading]       = useState(false);
  const [selected, setSelected]     = useState<Grn | null>(null);
  const [method, setMethod]         = useState<PayMethod>("CASH");
  const [amount, setAmount]         = useState("");
  const [chequeNo, setChequeNo]     = useState("");
  const [payDate, setPayDate]       = useState(() => new Date().toISOString().slice(0, 10));
  const [remarks, setRemarks]       = useState("");
  const [busy, setBusy]             = useState(false);
  const [msg, setMsg]               = useState<{ ok: boolean; text: string } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function runSearch(val: string) {
    setSearch(val);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      setLoading(true);
      const r = await fetch(`${apiBase}/sync/mirror/grns?search=${encodeURIComponent(val)}`, {
        headers: { Authorization: `Bearer ${token}` },
      }).then(r => r.json()).catch(() => ({ rows: [] }));
      setGrns(Array.isArray(r.rows) ? r.rows : []);
      setLoading(false);
    }, 250);
  }

  useEffect(() => { runSearch(""); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const balance = selected ? selected.gtotal - selected.paid : 0;
  const amountNum = Number(amount) || 0;

  function pick(g: Grn) {
    setSelected(g); setAmount(""); setChequeNo(""); setRemarks(""); setMsg(null);
  }

  async function submit() {
    if (!selected || amountNum <= 0) return;
    if (amountNum > balance) {
      setMsg({ ok: false, text: `Amount exceeds outstanding balance of ${fmt(balance)}.` });
      return;
    }
    if (method === "CHEQUE" && !chequeNo.trim()) {
      setMsg({ ok: false, text: "Cheque number is required for cheque payments." });
      return;
    }
    setBusy(true); setMsg(null);
    try {
      const r = await fetch(`${apiBase}/sync/pending-changes`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          type: "grn_payment",
          payload: {
            grnNo: selected.no, supplierCode: selected.scode,
            method, amount: amountNum,
            chequeNo: method === "CHEQUE" ? chequeNo.trim() : undefined,
            paymentDate: payDate, remarks: remarks.trim(),
          },
        }),
      });
      if (r.ok) {
        setMsg({ ok: true, text: "Payment queued — will post to MySQL (cash/bank leg, AP control account, creditor ledger, and voucher) within 30 seconds on next refresh." });
        setAmount(""); setChequeNo(""); setRemarks("");
      } else {
        setMsg({ ok: false, text: "Failed to queue payment." });
      }
    } catch { setMsg({ ok: false, text: "Network error." }); }
    setBusy(false);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      <div style={{ maxWidth: 480 }}>
        <label className="input-label">Search Invoice (GRN)</label>
        <input className="input-field" value={search} onChange={e => runSearch(e.target.value)}
          placeholder="Search by GRN number or supplier…" />
      </div>

      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        <div className="table-wrap" style={{ maxHeight: 260, overflowY: "auto" }}>
          <table className="data-table">
            <thead><tr><th>GRN</th><th>Supplier</th><th>Date</th><th>Total</th><th>Balance</th><th></th></tr></thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={6} className="muted">Loading…</td></tr>
              ) : grns.length === 0 ? (
                <tr><td colSpan={6} className="muted">No GRNs found.</td></tr>
              ) : grns.map(g => (
                <tr key={g.no} onClick={() => pick(g)}
                  style={{ cursor: "pointer", background: selected?.no === g.no ? "#f0fdf4" : undefined }}>
                  <td style={{ fontWeight: 700 }}>{g.no}</td>
                  <td>{g.sname || g.scode}</td>
                  <td className="muted">{g.ddate ? String(g.ddate).slice(0, 10) : "—"}</td>
                  <td>{fmt(g.gtotal)}</td>
                  <td style={{ fontWeight: 700, color: g.gtotal - g.paid > 0 ? "#dc2626" : "#16a34a" }}>
                    {fmt(g.gtotal - g.paid)}
                  </td>
                  <td>{selected?.no === g.no ? "✓" : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {selected && (
        <div className="card" style={{ padding: "1rem", maxWidth: 520, display: "flex", flexDirection: "column", gap: "0.75rem" }}>
          <div>
            <div style={{ fontWeight: 700 }}>{selected.no} — {selected.sname || selected.scode}</div>
            <div className="muted" style={{ fontSize: "0.82rem" }}>
              Total {fmt(selected.gtotal)} · Paid {fmt(selected.paid)} · Balance <strong>{fmt(balance)}</strong>
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
            <div>
              <label className="input-label">Method</label>
              <select className="input-field" value={method} onChange={e => setMethod(e.target.value as PayMethod)}>
                {PAY_METHODS.map(m => <option key={m} value={m}>{m === "BANK" ? "BANK TRANSFER" : m}</option>)}
              </select>
            </div>
            <div>
              <label className="input-label">Amount</label>
              <input className="input-field" type="number" min={0} step={0.01} value={amount}
                onChange={e => setAmount(e.target.value)} placeholder="0.00" />
            </div>
            {method === "CHEQUE" && (
              <div>
                <label className="input-label">Cheque No.</label>
                <input className="input-field" value={chequeNo} onChange={e => setChequeNo(e.target.value)} />
              </div>
            )}
            <div>
              <label className="input-label">Date</label>
              <input className="input-field" type="date" value={payDate} onChange={e => setPayDate(e.target.value)} />
            </div>
          </div>
          <div>
            <label className="input-label">Remarks (optional)</label>
            <input className="input-field" value={remarks} onChange={e => setRemarks(e.target.value)} />
          </div>

          {amountNum > balance && amountNum > 0 && (
            <div style={{ fontSize: "0.8rem", color: "#dc2626" }}>
              Amount exceeds the outstanding balance of {fmt(balance)}.
            </div>
          )}

          <button className="button" disabled={amountNum <= 0 || amountNum > balance || busy} onClick={submit}>
            {busy ? "Queuing…" : `Record ${method === "BANK" ? "Bank Transfer" : method === "CHEQUE" ? "Cheque" : "Cash"} Payment`}
          </button>
        </div>
      )}

      {msg && (
        <div style={{ padding: "0.65rem 0.75rem", borderRadius: 10, fontWeight: 600, maxWidth: 520,
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
  const [tab, setTab]       = useState<"adjust" | "grn" | "payments">("adjust");
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
    setHistory(Array.isArray(r) ? r.filter((c: Change) =>
      c.type === "stock_adjustment" || c.type === "goods_received" || c.type === "grn_payment") : []);
    setLoadingHistory(false);
  }

  if (!token) return null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
      <div>
        <h2 style={{ margin: 0, fontWeight: 800, letterSpacing: "-0.02em" }}>Stock Management</h2>
        <p className="muted" style={{ margin: "0.2rem 0 0", fontSize: "0.85rem" }}>
          Adjustments, GRNs, and GRN payments queue here and are applied to MySQL within 30 seconds of the next dashboard refresh.
        </p>
      </div>

      {/* Tab selector */}
      <div style={{ display: "flex", gap: "0.5rem", borderBottom: "1px solid var(--border)", paddingBottom: "0.5rem" }}>
        {(["adjust", "grn", "payments"] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            style={{ border: "none", cursor: "pointer", fontFamily: "inherit",
              padding: "0.4rem 0.9rem", borderRadius: 8, fontWeight: tab === t ? 700 : 400,
              color: tab === t ? "var(--teal)" : "var(--muted)",
              background: tab === t ? "#f0fdf4" : "none" } as any}>
            {t === "adjust" ? "Adjust Stock" : t === "grn" ? "Receive Goods (GRN)" : "GRN Payments"}
          </button>
        ))}
      </div>

      {/* Active tab */}
      <div className="card">
        {tab === "adjust" ? <AdjustTab token={token} /> : tab === "grn" ? <GrnTab token={token} /> : <GrnPaymentsTab token={token} />}
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
                          color: c.type === "goods_received" ? "#0f5ba7" : c.type === "grn_payment" ? "#b45309" : "#7c3aed" }}>
                          {c.type === "goods_received" ? "GRN" : c.type === "grn_payment" ? "Payment" : "Adjustment"}
                        </span>
                      </td>
                      <td style={{ fontSize: "0.85rem" }}>
                        {c.type === "stock_adjustment" ? (
                          <>
                            <strong>{c.payload.name || c.payload.sku}</strong>
                            {" "}{Number(c.payload.delta) > 0 ? "+" : ""}{c.payload.delta} units
                            {c.payload.reason ? <span className="muted"> · {c.payload.reason}</span> : null}
                          </>
                        ) : c.type === "grn_payment" ? (
                          <>
                            <strong>{c.payload.grnNo}</strong>
                            {" · "}{c.payload.method}
                            {c.payload.chequeNo ? ` #${c.payload.chequeNo}` : ""}
                            {" · "}{fmt(Number(c.payload.amount ?? 0))}
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
