"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const apiBase = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

type Product = {
  id: string; name: string; sku: string;
  price: string; stockQty: number;
  category: { name: string } | null;
};
type CartItem = Product & { qty: number; unitPrice: number };
type Receipt  = { id: string; createdAt: string; total: number; amountPaid: number; changeDue: number; items: any[]; paymentDetails: any; mysqlReceiptNo?: string | null };

const PAYMENT_METHODS = [
  { key: "cash",           label: "Cash" },
  { key: "mpesa",          label: "M-Pesa" },
  { key: "coop",           label: "CO-OP Bank" },
  { key: "equity_justann", label: "Equity (JustAnn)" },
  { key: "equity_mwalimu", label: "Equity (Mwalimu)" },
  { key: "kcb",            label: "KCB Bank" },
];

function fmt(n: number) {
  return n.toLocaleString("en-KE", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

export default function POSPage() {
  const [token, setToken]               = useState("");
  const [products, setProducts]         = useState<Product[]>([]);
  const [categories, setCategories]     = useState<string[]>([]);
  const [category, setCategory]         = useState("All");
  const [query, setQuery]               = useState("");
  const [page, setPage]                 = useState(1);
  const [pages, setPages]               = useState(1);
  const [loadingProd, setLoadingProd]   = useState(false);
  const [cart, setCart]                 = useState<CartItem[]>([]);
  const [showPay, setShowPay]           = useState(false);
  const [payAmounts, setPayAmounts]     = useState<Record<string, string>>({});
  const [payRef, setPayRef]             = useState("");
  const [paying, setPaying]             = useState(false);
  const [receipt, setReceipt]           = useState<Receipt | null>(null);
  const [autoPrint, setAutoPrint]       = useState(false);
  const [syncingReceipt, setSyncingReceipt] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const t = localStorage.getItem("mwalimu_token") ?? "";
    setToken(t);
  }, []);

  // Load categories
  useEffect(() => {
    if (!token) return;
    fetch(`${apiBase}/pos/categories`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json())
      .then(cats => setCategories(["All", ...cats.map((c: any) => c.name)]));
  }, [token]);

  // Load products
  const loadProducts = useCallback(() => {
    if (!token) return;
    setLoadingProd(true);
    const params = new URLSearchParams({ page: String(page), limit: "48" });
    if (query) params.set("q", query);
    if (category !== "All") params.set("category", category);
    fetch(`${apiBase}/pos/products?${params}`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json())
      .then(d => { setProducts(d.items ?? []); setPages(d.pages ?? 1); })
      .finally(() => setLoadingProd(false));
  }, [token, query, category, page]);

  useEffect(() => { loadProducts(); }, [loadProducts]);

  function addToCart(p: Product) {
    setCart(prev => {
      const exists = prev.find(i => i.id === p.id);
      if (exists) return prev.map(i => i.id === p.id ? { ...i, qty: i.qty + 1 } : i);
      return [...prev, { ...p, qty: 1, unitPrice: Number(p.price) }];
    });
  }

  function updateQty(id: string, delta: number) {
    setCart(prev => prev.map(i => i.id === id ? { ...i, qty: Math.max(0, i.qty + delta) } : i).filter(i => i.qty > 0));
  }

  function removeFromCart(id: string) { setCart(prev => prev.filter(i => i.id !== id)); }

  const subtotal = cart.reduce((s, i) => s + i.unitPrice * i.qty, 0);

  const totalPaid = Object.values(payAmounts).reduce((s, v) => s + (parseFloat(v) || 0), 0);
  const change    = Math.max(0, totalPaid - subtotal);
  const shortfall = Math.max(0, subtotal - totalPaid);

  async function completeSale() {
    if (!cart.length || shortfall > 0) return;
    setPaying(true);
    try {
      const pd: Record<string, number> = {};
      PAYMENT_METHODS.forEach(m => { pd[m.key] = parseFloat(payAmounts[m.key] || "0") || 0; });

      const r = await fetch(`${apiBase}/pos/sale`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          items: cart.map(i => ({ productId: i.id, sku: i.sku, name: i.name, qty: i.qty, unitPrice: i.unitPrice, discount: 0 })),
          paymentDetails: { ...pd, ref: payRef },
          amountPaid: totalPaid,
        }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data?.error ?? "Sale failed");

      const newReceipt = { ...data, total: subtotal, amountPaid: totalPaid, changeDue: change, paymentDetails: pd };
      setReceipt(newReceipt);
      setCart([]);
      setShowPay(false);
      setPayAmounts({});
      setPayRef("");

      // Auto-print immediately with web receipt (before bridge sync)
      if (autoPrint) setTimeout(() => window.print(), 400);

      // Trigger bridge sync and poll for the MySQL receipt number in the background
      syncReceiptNo(data.id);
    } catch (e: any) {
      alert(e.message);
    } finally {
      setPaying(false);
    }
  }

  // Send a print job to the office PC's physical printer via the bridge
  async function printOnOfficePrinter() {
    if (!receipt) return;
    await fetch(`${apiBase}/sync/pending-changes`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "print_receipt",
        payload: {
          receiptNo:      receipt.mysqlReceiptNo ?? `WEB-${receipt.id.slice(-8).toUpperCase()}`,
          date:           receipt.createdAt,
          items:          receipt.items?.map((i: any) => ({
            name:      i.product?.name ?? i.name ?? "Item",
            qty:       i.qty,
            unitPrice: Number(i.unitPrice),
          })),
          total:          receipt.total,
          amountPaid:     receipt.amountPaid,
          changeDue:      receipt.changeDue,
          paymentDetails: receipt.paymentDetails,
          ref:            receipt.paymentDetails?.ref,
        },
      }),
    });
    // Wake bridge to pick up the print job
    await fetch(`${apiBase}/sync/request`, { method: "POST", headers: { Authorization: `Bearer ${token}` } }).catch(() => {});
    alert("Print job sent to office printer. It will print within a few seconds.");
  }

  // After sale: wake the bridge and poll until it writes the MySQL receipt number
  async function syncReceiptNo(orderId: string) {
    setSyncingReceipt(true);
    try {
      // Wake the bridge so it picks up the sale quickly
      await fetch(`${apiBase}/sync/request`, { method: "POST", headers: { Authorization: `Bearer ${token}` } }).catch(() => {});
      const deadline = Date.now() + 120000; // wait up to 2 minutes
      while (Date.now() < deadline) {
        await new Promise(r => setTimeout(r, 4000));
        const res = await fetch(`${apiBase}/pos/sale/${orderId}`, {
          headers: { Authorization: `Bearer ${token}` },
        }).then(r => r.json()).catch(() => null);
        if (res?.mysqlReceiptNo) {
          setReceipt(prev => prev ? { ...prev, mysqlReceiptNo: res.mysqlReceiptNo } : prev);
          return;
        }
      }
    } finally {
      setSyncingReceipt(false);
    }
  }

  function newSale() { setReceipt(null); setSyncingReceipt(false); loadProducts(); searchRef.current?.focus(); }

  // ── Receipt screen ──
  if (receipt) {
    const receiptLabel = receipt.mysqlReceiptNo
      ? `Receipt #${receipt.mysqlReceiptNo}`
      : `Web Ref: ${receipt.id.slice(-8).toUpperCase()}`;

    return (
      <div className="pos-receipt-wrap">
        <div className="pos-receipt">
          {/* ── Printable area ── */}
          <div className="pos-receipt-header">
            <div className="pos-receipt-brand">Mwalimu Cosmetics</div>
            <div className="pos-receipt-date">{new Date(receipt.createdAt).toLocaleString("en-KE")}</div>
            <div style={{ fontSize: "0.82rem", marginTop: "0.25rem",
              color: receipt.mysqlReceiptNo ? "#065f46" : "var(--muted)",
              fontWeight: receipt.mysqlReceiptNo ? 700 : 400 }}>
              {receiptLabel}
            </div>
          </div>

          <table className="pos-receipt-table">
            <thead><tr><th>Item</th><th>Qty</th><th>Price</th><th>Total</th></tr></thead>
            <tbody>
              {receipt.items?.map((i: any, idx: number) => (
                <tr key={idx}>
                  <td>{i.product?.name ?? i.name}</td>
                  <td>{i.qty}</td>
                  <td>KES {fmt(Number(i.unitPrice))}</td>
                  <td>KES {fmt(Number(i.unitPrice) * i.qty)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="pos-receipt-totals">
            <div className="pos-receipt-row"><span>Subtotal</span><strong>KES {fmt(receipt.total)}</strong></div>
            <div className="pos-receipt-row"><span>Paid</span><strong>KES {fmt(receipt.amountPaid)}</strong></div>
            {receipt.changeDue > 0 && <div className="pos-receipt-row change"><span>Change</span><strong>KES {fmt(receipt.changeDue)}</strong></div>}
          </div>

          <div className="pos-receipt-methods">
            {PAYMENT_METHODS.filter(m => (receipt.paymentDetails?.[m.key] || 0) > 0).map(m => (
              <div key={m.key} className="pos-receipt-method">
                <span>{m.label}</span>
                <span>KES {fmt(receipt.paymentDetails[m.key])}</span>
              </div>
            ))}
          </div>

          <div className="pos-receipt-footer">Thank you for shopping with us!</div>

          {/* ── On-screen only (hidden when printing) ── */}
          <div className="pos-receipt-actions">
            {/* POS sync status */}
            {syncingReceipt && !receipt.mysqlReceiptNo && (
              <div style={{ fontSize: "0.78rem", color: "var(--muted)", textAlign: "center",
                padding: "0.5rem 0", borderTop: "1px dashed var(--border)", marginTop: "0.75rem" }}>
                ⏳ Syncing receipt number with POS…
              </div>
            )}
            {receipt.mysqlReceiptNo && (
              <div style={{ fontSize: "0.78rem", color: "#16a34a", textAlign: "center",
                padding: "0.5rem 0", borderTop: "1px dashed var(--border)", marginTop: "0.75rem" }}>
                ✓ Synced to POS — Receipt #{receipt.mysqlReceiptNo}
              </div>
            )}

            <div style={{ display: "flex", gap: "0.75rem", marginTop: "0.75rem" }}>
              <button className="button full" onClick={newSale}>New Sale</button>
              <button className="button ghost full" onClick={() => window.print()}>
                Print {receipt.mysqlReceiptNo ? "Receipt" : "Now"}
              </button>
            </div>
            <button
              className="button ghost full"
              style={{ marginTop: "0.5rem", fontSize: "0.82rem" }}
              onClick={printOnOfficePrinter}>
              🖨 Print on Office Printer
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Main POS ──
  return (
    <div className="pos-shell">
      {/* Product panel */}
      <div className="pos-products">
        <div className="pos-search-bar">
          <input ref={searchRef} className="pos-search-input" placeholder="Search by name or barcode…"
            value={query} onChange={e => { setQuery(e.target.value); setPage(1); }} autoFocus />
        </div>

        {/* Category pills */}
        <div className="pos-cat-bar">
          {categories.map(c => (
            <button key={c} className={`pos-cat-pill ${category === c ? "active" : ""}`}
              onClick={() => { setCategory(c); setPage(1); }}>{c}</button>
          ))}
        </div>

        {/* Product grid */}
        {loadingProd ? (
          <div className="pos-loading">Loading products…</div>
        ) : (
          <>
            <div className="pos-grid">
              {products.map(p => {
                const inCart = cart.find(i => i.id === p.id);
                return (
                  <div key={p.id}
                    className={`pos-product-tile ${p.stockQty <= 0 ? "out-of-stock" : ""} ${inCart ? "in-cart" : ""}`}
                    onClick={() => p.stockQty > 0 && addToCart(p)}>
                    <div className="pos-tile-img">
                      <span style={{ fontSize:"1.5rem", opacity:0.3 }}>🧴</span>
                    </div>
                    <div className="pos-tile-name">{p.name}</div>
                    <div className="pos-tile-price">KES {fmt(Number(p.price))}</div>
                    <div className="pos-tile-stock">
                      {p.stockQty <= 0 ? "Out of stock" : `${p.stockQty} in stock`}
                    </div>
                    {inCart && <div className="pos-tile-badge">{inCart.qty}</div>}
                  </div>
                );
              })}
              {!products.length && (
                <div style={{ gridColumn:"1/-1", textAlign:"center", padding:"3rem", color:"var(--muted)" }}>
                  No products found. Run the sync agent to load the catalogue.
                </div>
              )}
            </div>
            {pages > 1 && (
              <div className="pos-pagination">
                <button className="button ghost" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>← Prev</button>
                <span className="muted">Page {page} of {pages}</span>
                <button className="button ghost" disabled={page >= pages} onClick={() => setPage(p => p + 1)}>Next →</button>
              </div>
            )}
          </>
        )}
      </div>

      {/* Cart panel */}
      <div className="pos-cart">
        <div className="pos-cart-head">
          <span className="pos-cart-title">Cart {cart.length > 0 && `(${cart.reduce((s,i)=>s+i.qty,0)})`}</span>
          {cart.length > 0 && <button className="pos-clear-btn" style={{width:"auto",padding:"0.25rem 0.6rem"}} onClick={() => setCart([])}>Clear</button>}
        </div>

        <div className="pos-cart-items">
          {cart.length === 0 && (
            <div style={{ textAlign:"center", padding:"2rem", color:"var(--muted)", fontSize:"0.9rem" }}>
              Tap a product to add it
            </div>
          )}
          {cart.map(item => (
            <div key={item.id} className="pos-cart-row">
              <div>
                <div className="pos-cart-row-name">{item.name}</div>
                <div className="pos-cart-row-price">KES {fmt(item.unitPrice)} × {item.qty} = KES {fmt(item.unitPrice * item.qty)}</div>
              </div>
              <div style={{ display:"flex", flexDirection:"column", alignItems:"flex-end", gap:"0.25rem" }}>
                <div className="pos-qty-ctrl">
                  <button className="pos-qty-btn" onClick={() => updateQty(item.id, -1)}>−</button>
                  <span className="pos-qty-val">{item.qty}</span>
                  <button className="pos-qty-btn" onClick={() => updateQty(item.id, 1)}>+</button>
                </div>
                <button onClick={() => removeFromCart(item.id)}
                  style={{ background:"none", border:"none", color:"#dc2626", cursor:"pointer", fontSize:"0.78rem" }}>
                  Remove
                </button>
              </div>
            </div>
          ))}
        </div>

        <div className="pos-cart-foot">
          <div className="pos-total-row">
            <span>Total</span>
            <span className="pos-total-amount">KES {fmt(subtotal)}</span>
          </div>
          <button className="pos-pay-btn" disabled={!cart.length} onClick={() => setShowPay(true)}>
            Charge KES {fmt(subtotal)}
          </button>
        </div>
      </div>

      {/* Payment modal */}
      {showPay && (
        <div className="pos-modal-backdrop" onClick={e => e.target === e.currentTarget && setShowPay(false)}>
          <div className="pos-modal">
            <h2 className="pos-modal-title">Payment — KES {fmt(subtotal)}</h2>

            <div style={{ display:"flex", flexDirection:"column", gap:"0.65rem" }}>
              {PAYMENT_METHODS.map(m => (
                <label key={m.key} style={{ display:"grid", gridTemplateColumns:"1fr auto", gap:"0.5rem", alignItems:"center" }}>
                  <span style={{ fontWeight:600, fontSize:"0.9rem" }}>{m.label}</span>
                  <input type="number" min="0" placeholder="0"
                    className="filter-input" style={{ width:120, textAlign:"right" }}
                    value={payAmounts[m.key] ?? ""}
                    onChange={e => setPayAmounts(prev => ({ ...prev, [m.key]: e.target.value }))} />
                </label>
              ))}
              <label style={{ display:"grid", gridTemplateColumns:"1fr auto", gap:"0.5rem", alignItems:"center" }}>
                <span style={{ fontWeight:600, fontSize:"0.9rem" }}>Reference / Transaction ID</span>
                <input type="text" placeholder="e.g. MPESA code" className="filter-input" style={{ width:140 }}
                  value={payRef} onChange={e => setPayRef(e.target.value)} />
              </label>
            </div>

            <div style={{ background: shortfall > 0 ? "#fef2f2" : "#ecfdf5", border:`1px solid ${shortfall>0?"#fecdd3":"#a7f3d0"}`, borderRadius:10, padding:"0.75rem", textAlign:"center" }}>
              {shortfall > 0 ? (
                <span style={{ color:"#dc2626", fontWeight:700 }}>KES {fmt(shortfall)} still needed</span>
              ) : (
                <span style={{ color:"#065f46", fontWeight:700 }}>
                  Change: KES {fmt(change)} ✓
                </span>
              )}
            </div>

            <label style={{ display: "flex", alignItems: "center", gap: "0.5rem",
              fontSize: "0.85rem", cursor: "pointer", userSelect: "none" }}>
              <input type="checkbox" checked={autoPrint}
                onChange={e => setAutoPrint(e.target.checked)}
                style={{ width: 16, height: 16, cursor: "pointer" }} />
              Auto-print receipt after sale
            </label>

            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"0.65rem" }}>
              <button className="pos-cancel-btn" onClick={() => setShowPay(false)}>Cancel</button>
              <button className="pos-confirm-btn" disabled={paying || shortfall > 0} onClick={completeSale}>
                {paying ? "Processing…" : "Complete Sale"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
