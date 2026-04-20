"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const apiBase = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

type Product = {
  id: string;
  name: string;
  sku: string;
  price: number;
  currency: string;
  stockQty: number;
  imageUrl?: string | null;
};

type CartItem = {
  product: Product;
  qty: number;
  discount: number;
};

type PaymentMethod = "CASH" | "CARD" | "MOBILE_MONEY" | "BANK_TRANSFER";

const METHOD_LABELS: Record<PaymentMethod, string> = {
  CASH: "Cash",
  CARD: "Card",
  MOBILE_MONEY: "M-Pesa",
  BANK_TRANSFER: "Bank Transfer",
};

function fmt(n: number) {
  return new Intl.NumberFormat("en-KE", { style: "currency", currency: "KES", maximumFractionDigits: 0 }).format(n);
}

function normalizeImageUrl(url?: string | null) {
  if (!url) return null;
  const t = url.trim();
  if (!t) return null;
  if (t.startsWith("/")) return `${apiBase.replace(/\/$/, "")}${t}`;
  if (t.startsWith("http://api.mwalimucosmetics.com")) return t.replace("http://", "https://");
  return t;
}

export default function POSPage() {
  const [token, setToken] = useState<string | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [filtered, setFiltered] = useState<Product[]>([]);
  const [query, setQuery] = useState("");
  const [cart, setCart] = useState<CartItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);

  // Payment modal state
  const [payModalOpen, setPayModalOpen] = useState(false);
  const [payMethod, setPayMethod] = useState<PaymentMethod>("CASH");
  const [cashTendered, setCashTendered] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [lastReceipt, setLastReceipt] = useState<{ orderId: string; total: number; method: PaymentMethod; change: number } | null>(null);
  const [receiptOpen, setReceiptOpen] = useState(false);

  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const t = localStorage.getItem("mwalimu_token");
    setToken(t);
    loadProducts(t);
  }, []);

  useEffect(() => {
    const q = query.trim().toLowerCase();
    if (!q) {
      setFiltered(products);
      return;
    }
    setFiltered(
      products.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          p.sku.toLowerCase().includes(q)
      )
    );
  }, [query, products]);

  async function loadProducts(authToken?: string | null) {
    setFetchError(null);
    setLoading(true);
    try {
      const headers: Record<string, string> = {};
      if (authToken) headers.Authorization = `Bearer ${authToken}`;
      const res = await fetch(`${apiBase}/products?status=ACTIVE&take=200`, { headers, cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error ?? "Could not load products");
      const items: Product[] = ((data?.data ?? []) as any[]).map((p) => ({
        id: p.id,
        name: p.name,
        sku: p.sku,
        price: Number(p.price),
        currency: p.currency ?? "KES",
        stockQty: Number(p.stockQty ?? 0),
        imageUrl: p.imageUrl ?? null,
      }));
      setProducts(items);
      setFiltered(items);
    } catch (err: any) {
      setFetchError(err?.message ?? "Could not load products");
    } finally {
      setLoading(false);
    }
  }

  const addToCart = useCallback((product: Product) => {
    if (product.stockQty <= 0) return;
    setCart((prev) => {
      const existing = prev.find((i) => i.product.id === product.id);
      if (existing) {
        if (existing.qty >= product.stockQty) return prev;
        return prev.map((i) => i.product.id === product.id ? { ...i, qty: i.qty + 1 } : i);
      }
      return [...prev, { product, qty: 1, discount: 0 }];
    });
  }, []);

  function setQty(productId: string, qty: number) {
    if (qty <= 0) {
      setCart((prev) => prev.filter((i) => i.product.id !== productId));
    } else {
      setCart((prev) => prev.map((i) => i.product.id === productId ? { ...i, qty } : i));
    }
  }

  function setDiscount(productId: string, discount: number) {
    setCart((prev) => prev.map((i) => i.product.id === productId ? { ...i, discount: Math.max(0, Math.min(discount, i.product.price * i.qty)) } : i));
  }

  const subtotal = cart.reduce((sum, i) => sum + i.product.price * i.qty - i.discount, 0);
  const cashTenderedNum = parseFloat(cashTendered) || 0;
  const change = cashTenderedNum - subtotal;

  function openPayModal() {
    if (cart.length === 0) return;
    setSubmitError(null);
    setCashTendered("");
    setPayModalOpen(true);
  }

  async function confirmPayment() {
    if (!token) {
      setSubmitError("You must be signed in to process a sale.");
      return;
    }
    if (payMethod === "CASH" && cashTenderedNum < subtotal) {
      setSubmitError("Cash tendered is less than the total.");
      return;
    }
    setSubmitting(true);
    setSubmitError(null);
    try {
      const res = await fetch(`${apiBase}/orders`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          channel: "COUNTER",
          paymentMethod: payMethod,
          items: cart.map((i) => ({
            productId: i.product.id,
            name: i.product.name,
            qty: i.qty,
            unitPrice: i.product.price,
          })),
          customer: customerName || customerPhone
            ? { name: customerName || undefined, phone: customerPhone || undefined }
            : undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error ?? "Order failed");

      const orderId = data?.data?.id ?? "—";
      setLastReceipt({ orderId, total: subtotal, method: payMethod, change: payMethod === "CASH" ? change : 0 });
      setCart([]);
      setCustomerName("");
      setCustomerPhone("");
      setPayModalOpen(false);
      setReceiptOpen(true);
      loadProducts(token);
    } catch (err: any) {
      setSubmitError(err?.message ?? "Order failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="pos-shell">
      {/* Left: product grid */}
      <div className="pos-products">
        <div className="pos-search-bar">
          <input
            ref={searchRef}
            className="pos-search-input"
            placeholder="Search by name or SKU…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoFocus
          />
          {query && (
            <button className="button ghost" style={{ padding: "0.5rem 0.75rem" }} onClick={() => setQuery("")}>
              Clear
            </button>
          )}
          <button
            className="button ghost"
            style={{ padding: "0.5rem 0.75rem" }}
            onClick={() => loadProducts(token)}
          >
            ↻
          </button>
        </div>

        {fetchError && (
          <div className="signin-error" style={{ margin: "0.75rem" }}>{fetchError}</div>
        )}

        {loading ? (
          <div style={{ padding: "2rem", textAlign: "center", color: "var(--muted)" }}>Loading products…</div>
        ) : (
          <div className="pos-grid">
            {filtered.length === 0 && (
              <div style={{ gridColumn: "1/-1", color: "var(--muted)", padding: "1rem" }}>
                No products found.
              </div>
            )}
            {filtered.map((p) => {
              const imgUrl = normalizeImageUrl(p.imageUrl);
              const inCart = cart.find((i) => i.product.id === p.id);
              return (
                <div
                  key={p.id}
                  className={`pos-product-tile ${p.stockQty <= 0 ? "out-of-stock" : ""}`}
                  onClick={() => addToCart(p)}
                  title={p.stockQty <= 0 ? "Out of stock" : `Add ${p.name} to cart`}
                >
                  {imgUrl ? (
                    <img src={imgUrl} alt={p.name} className="pos-tile-img" />
                  ) : (
                    <div className="pos-tile-img" style={{ display: "flex", alignItems: "center", justifyContent: "center", fontSize: "0.7rem", color: "var(--muted)" }}>
                      {p.sku}
                    </div>
                  )}
                  <div className="pos-tile-name">{p.name}</div>
                  <div className="pos-tile-price">{fmt(p.price)}</div>
                  <div className="pos-tile-stock">
                    {p.stockQty <= 0 ? "Out of stock" : `${p.stockQty} in stock`}
                    {inCart && <span style={{ marginLeft: "0.35rem", color: "#0f5ba7", fontWeight: 700 }}>({inCart.qty} in cart)</span>}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Right: cart */}
      <div className="pos-cart">
        <div className="pos-cart-head">
          <span className="pos-cart-title">Cart {cart.length > 0 && `(${cart.reduce((s, i) => s + i.qty, 0)} items)`}</span>
          {cart.length > 0 && (
            <button
              className="pos-clear-btn"
              style={{ width: "auto", padding: "0.3rem 0.7rem" }}
              onClick={() => setCart([])}
            >
              Clear
            </button>
          )}
        </div>

        <div className="pos-cart-items">
          {cart.length === 0 && (
            <div style={{ color: "var(--muted)", textAlign: "center", padding: "2rem 1rem", fontSize: "0.9rem" }}>
              Tap a product to add it to the cart
            </div>
          )}
          {cart.map((item) => (
            <div key={item.product.id} className="pos-cart-row">
              <div>
                <div className="pos-cart-row-name">{item.product.name}</div>
                <div className="pos-cart-row-price">
                  {fmt(item.product.price)} × {item.qty}
                  {item.discount > 0 && (
                    <span style={{ color: "#16a34a", marginLeft: "0.35rem" }}>− {fmt(item.discount)}</span>
                  )}
                </div>
                <div style={{ display: "flex", gap: "0.4rem", marginTop: "0.3rem", alignItems: "center" }}>
                  <span style={{ fontSize: "0.78rem", color: "var(--muted)" }}>Disc KES</span>
                  <input
                    type="number"
                    min="0"
                    step="10"
                    value={item.discount || ""}
                    placeholder="0"
                    onChange={(e) => setDiscount(item.product.id, parseFloat(e.target.value) || 0)}
                    style={{ width: "60px", border: "1px solid var(--border)", borderRadius: "6px", padding: "0.2rem 0.4rem", fontSize: "0.8rem" }}
                  />
                </div>
              </div>
              <div className="pos-qty-ctrl">
                <button className="pos-qty-btn" onClick={() => setQty(item.product.id, item.qty - 1)}>−</button>
                <span className="pos-qty-val">{item.qty}</span>
                <button
                  className="pos-qty-btn"
                  onClick={() => setQty(item.product.id, item.qty + 1)}
                  disabled={item.qty >= item.product.stockQty}
                >+</button>
              </div>
            </div>
          ))}
        </div>

        <div className="pos-cart-foot">
          <div className="pos-total-row">
            <span>Total</span>
            <span className="pos-total-amount">{fmt(subtotal)}</span>
          </div>
          <button className="pos-pay-btn" onClick={openPayModal} disabled={cart.length === 0}>
            Collect Payment
          </button>
        </div>
      </div>

      {/* Payment modal */}
      {payModalOpen && (
        <div className="pos-modal-backdrop" onClick={(e) => e.target === e.currentTarget && setPayModalOpen(false)}>
          <div className="pos-modal">
            <h2 className="pos-modal-title">Collect Payment</h2>

            <div>
              <div style={{ fontWeight: 700, marginBottom: "0.5rem", fontSize: "0.85rem", textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--muted)" }}>Payment method</div>
              <div className="pos-method-grid">
                {(Object.keys(METHOD_LABELS) as PaymentMethod[]).map((m) => (
                  <button
                    key={m}
                    className={`pos-method-btn ${payMethod === m ? "selected" : ""}`}
                    onClick={() => setPayMethod(m)}
                  >
                    {METHOD_LABELS[m]}
                  </button>
                ))}
              </div>
            </div>

            {payMethod === "CASH" && (
              <div>
                <label className="input-group">
                  <span>Cash tendered (KES)</span>
                  <input
                    type="number"
                    min="0"
                    step="50"
                    value={cashTendered}
                    onChange={(e) => setCashTendered(e.target.value)}
                    placeholder={String(Math.ceil(subtotal / 50) * 50)}
                    autoFocus
                  />
                </label>
                {cashTenderedNum >= subtotal && (
                  <div className="pos-change-display" style={{ marginTop: "0.5rem" }}>
                    Change: {fmt(change)}
                  </div>
                )}
              </div>
            )}

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem" }}>
              <label className="input-group">
                <span>Customer name</span>
                <input value={customerName} onChange={(e) => setCustomerName(e.target.value)} placeholder="Optional" />
              </label>
              <label className="input-group">
                <span>Phone</span>
                <input value={customerPhone} onChange={(e) => setCustomerPhone(e.target.value)} placeholder="0712 345 678" />
              </label>
            </div>

            <div style={{ borderTop: "1px solid var(--border)", paddingTop: "0.75rem" }}>
              <div className="pos-total-row" style={{ marginBottom: "0.5rem" }}>
                <span style={{ fontWeight: 700 }}>Total to collect</span>
                <span className="pos-total-amount">{fmt(subtotal)}</span>
              </div>
              {submitError && <div className="signin-error" style={{ marginBottom: "0.5rem" }}>{submitError}</div>}
              <button className="pos-confirm-btn" onClick={confirmPayment} disabled={submitting} style={{ width: "100%", marginBottom: "0.5rem" }}>
                {submitting ? "Processing…" : `Confirm ${METHOD_LABELS[payMethod]}`}
              </button>
              <button className="pos-cancel-btn" onClick={() => setPayModalOpen(false)} style={{ width: "100%" }}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* Receipt / success modal */}
      {receiptOpen && lastReceipt && (
        <div className="pos-modal-backdrop" onClick={(e) => e.target === e.currentTarget && setReceiptOpen(false)}>
          <div className="pos-modal" style={{ textAlign: "center", gap: "0.75rem" }}>
            <div style={{ fontSize: "2.5rem" }}>✓</div>
            <h2 className="pos-modal-title" style={{ textAlign: "center" }}>Sale Complete</h2>
            <div style={{ background: "#f8fafc", border: "1px solid var(--border)", borderRadius: "10px", padding: "1rem", display: "grid", gap: "0.4rem" }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ color: "var(--muted)" }}>Order ID</span>
                <span style={{ fontWeight: 700 }}>{lastReceipt.orderId}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ color: "var(--muted)" }}>Total</span>
                <span style={{ fontWeight: 800, color: "#b12704" }}>{fmt(lastReceipt.total)}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ color: "var(--muted)" }}>Method</span>
                <span style={{ fontWeight: 700 }}>{METHOD_LABELS[lastReceipt.method]}</span>
              </div>
              {lastReceipt.change > 0 && (
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span style={{ color: "var(--muted)" }}>Change</span>
                  <span style={{ fontWeight: 800, color: "#16a34a" }}>{fmt(lastReceipt.change)}</span>
                </div>
              )}
            </div>
            <button
              className="pos-confirm-btn"
              onClick={() => { setReceiptOpen(false); searchRef.current?.focus(); }}
              style={{ width: "100%" }}
            >
              New Sale
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
