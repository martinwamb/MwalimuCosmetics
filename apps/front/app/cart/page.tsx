"use client";

import { useEffect, useMemo, useState } from "react";

type CartItem = { id: string; slug?: string | null; name: string; price: number; qty: number };

const orderEmail = process.env.NEXT_PUBLIC_ORDER_EMAIL;
const orderWhatsApp = process.env.NEXT_PUBLIC_ORDER_WHATSAPP;
const orderTelegram = process.env.NEXT_PUBLIC_ORDER_TELEGRAM;
const apiBase = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

function formatKES(value: number) {
  return new Intl.NumberFormat("en-KE", { style: "currency", currency: "KES", maximumFractionDigits: 2 }).format(value);
}

function normalizeCart(raw: unknown): CartItem[] {
  if (!Array.isArray(raw)) return [];
  const merged: CartItem[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const id = (entry as any).id;
    const name = (entry as any).name;
    const price = Number((entry as any).price);
    const qty = Number((entry as any).qty ?? 1);
    const slug = (entry as any).slug ?? null;
    if (!id || !name || Number.isNaN(price) || Number.isNaN(qty)) continue;
    const key = `${id}-${price}`;
    const existing = merged.findIndex((item) => `${item.id}-${item.price}` === key);
    if (existing >= 0) {
      merged[existing].qty += Math.max(1, Math.round(qty));
    } else {
      merged.push({ id, slug, name, price, qty: Math.max(1, Math.round(qty)) });
    }
  }
  return merged;
}

function normalizePhone(phone?: string | null) {
  if (!phone) return "";
  return phone.replace(/[^\d]/g, "");
}

export default function CartPage() {
  const [cart, setCart] = useState<CartItem[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [customer, setCustomer] = useState({
    name: "",
    email: "",
    phone: "",
    address: "",
    marketingOptIn: false
  });

  useEffect(() => {
    try {
      const stored = localStorage.getItem("mwalimu_cart");
      if (stored) {
        setCart(normalizeCart(JSON.parse(stored)));
      }
    } catch {
      // ignore hydration errors
    } finally {
      setHydrated(true);
    }
  }, []);

  function persist(next: CartItem[]) {
    setCart(next);
    try {
      localStorage.setItem("mwalimu_cart", JSON.stringify(next));
      window.dispatchEvent(new Event("mwalimu-cart-updated"));
    } catch {
      // ignore storage errors
    }
  }

  function updateQty(index: number, qty: number) {
    const normalized = Number.isFinite(qty) ? Math.max(0, Math.round(qty)) : 0;
    if (normalized <= 0) {
      removeItem(index);
      return;
    }
    const next = [...cart];
    next[index] = { ...next[index], qty: normalized };
    persist(next);
  }

  function removeItem(index: number) {
    const next = cart.filter((_, i) => i !== index);
    persist(next);
    setNotice("Removed item from cart.");
    setTimeout(() => setNotice(null), 1500);
  }

  function clearCart() {
    persist([]);
    setNotice("Cleared cart.");
    setTimeout(() => setNotice(null), 1500);
  }

  async function copyOrderDetails(text: string) {
    try {
      await navigator.clipboard?.writeText(text);
      setNotice("Order details copied. Paste into your channel to send.");
      setTimeout(() => setNotice(null), 1800);
    } catch {
      setNotice("Copy failed. Select and copy manually.");
      setTimeout(() => setNotice(null), 1800);
    }
  }

  const subtotal = useMemo(() => cart.reduce((sum, item) => sum + item.price * item.qty, 0), [cart]);
  const totalItems = useMemo(() => cart.reduce((sum, item) => sum + item.qty, 0), [cart]);

  const orderLines = cart
    .map((item, idx) => `${idx + 1}. ${item.name} x${item.qty} @ ${formatKES(item.price)} = ${formatKES(item.price * item.qty)}`)
    .join("\n");
  const orderMessage =
    cart.length === 0
      ? "Cart is empty."
      : `New order from Mwalimu Cosmetics\n\nItems:\n${orderLines}\n\nTotal items: ${totalItems}\nSubtotal: ${formatKES(subtotal)}\n\nPlease confirm delivery option and payment instructions.`;

  const mailtoHref =
    orderEmail && cart.length
      ? `mailto:${orderEmail}?subject=${encodeURIComponent("New Mwalimu Cosmetics order")}&body=${encodeURIComponent(orderMessage)}`
      : null;
  const whatsappHref =
    normalizePhone(orderWhatsApp) && cart.length
      ? `https://wa.me/${normalizePhone(orderWhatsApp)}?text=${encodeURIComponent(orderMessage)}`
      : null;
  const telegramHref =
    orderTelegram && cart.length
      ? `https://t.me/share/url?url=${encodeURIComponent("https://mwalimucosmetics.com/cart")}&text=${encodeURIComponent(orderMessage)}`
      : null;

  async function placeOrder() {
    if (cart.length === 0) return;
    setSubmitting(true);
    setError(null);

    try {
      const res = await fetch(`${apiBase}/orders`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          channel: "ONLINE",
          items: cart.map((item) => ({
            productId: item.id,
            slug: item.slug,
            name: item.name,
            qty: item.qty,
            unitPrice: item.price
          })),
          customer: {
            name: customer.name || undefined,
            email: customer.email || undefined,
            phone: customer.phone || undefined,
            address: customer.address || undefined,
            marketingOptIn: customer.marketingOptIn
          }
        })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error((data?.error as string) ?? "Order failed");
      }
      setNotice("Order placed. We emailed your order summary and will update you with the status.");
      persist([]);
      setCustomer((prev) => ({ ...prev, address: "", phone: "", name: "", email: "" }));
    } catch (err: any) {
      setError(err?.message ?? "Could not place order.");
    } finally {
      setSubmitting(false);
      setTimeout(() => setNotice(null), 2200);
    }
  }

  return (
    <div className="card">
      <h2 style={{ marginTop: 0 }}>Cart</h2>
      <p className="muted" style={{ marginTop: 0 }}>
        Review your picks, adjust quantities, then place the order via email, WhatsApp, or Telegram.
      </p>
      {notice && <p className="signin-success">{notice}</p>}

      {!hydrated && <p className="muted">Loading your cart...</p>}

      {hydrated && cart.length === 0 && (
        <div style={{ marginTop: "0.5rem" }}>
          <p className="muted" style={{ marginTop: 0 }}>
            Your cart is empty. Add products from the storefront to see them here.
          </p>
          <a href="/" className="text-link">
            Browse products
          </a>
        </div>
      )}

      {hydrated && cart.length > 0 && (
        <div className="grid grid-cols-3 gap-4" style={{ marginTop: "0.75rem" }}>
          <section className="col-span-2">
            <div className="card" style={{ boxShadow: "none", padding: "0.75rem 1rem" }}>
              {cart.map((item, index) => (
                <div
                  key={`${item.id}-${item.price}-${index}`}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr auto auto",
                    alignItems: "center",
                    gap: "0.75rem",
                    padding: "0.75rem 0",
                    borderBottom: "1px solid #eee"
                  }}
                >
                  <div>
                    <strong>{item.name}</strong>
                    <div className="muted small">
                      {formatKES(item.price)} each - Line total {formatKES(item.price * item.qty)}
                    </div>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                    <button
                      type="button"
                      className="button ghost"
                      style={{ padding: "0.35rem 0.6rem" }}
                      onClick={() => updateQty(index, item.qty - 1)}
                      aria-label={`Decrease quantity for ${item.name}`}
                    >
                      -
                    </button>
                    <input
                      type="number"
                      min={1}
                      value={item.qty}
                      onChange={(e) => updateQty(index, Number(e.target.value))}
                      style={{ width: "4rem", padding: "0.35rem 0.5rem" }}
                      aria-label={`Quantity for ${item.name}`}
                    />
                    <button
                      type="button"
                      className="button ghost"
                      style={{ padding: "0.35rem 0.6rem" }}
                      onClick={() => updateQty(index, item.qty + 1)}
                      aria-label={`Increase quantity for ${item.name}`}
                    >
                      +
                    </button>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <button className="text-link" type="button" onClick={() => removeItem(index)}>
                      Remove
                    </button>
                  </div>
                </div>
              ))}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "0.5rem" }}>
                <div className="muted small">Items: {totalItems}</div>
                <button className="text-link" type="button" onClick={() => clearCart()}>
                  Clear cart
                </button>
              </div>
            </div>
          </section>

          <aside className="card" style={{ alignSelf: "start" }}>
            <div className="hero-eyebrow" style={{ marginBottom: "0.3rem" }}>
              Order summary
            </div>
            <div className="price" style={{ marginTop: 0 }}>
              {formatKES(subtotal)}
            </div>
            <p className="muted small" style={{ marginTop: 0 }}>
              Choose where to send your order details. We prefill the message with the items above.
            </p>
            <div style={{ display: "grid", gap: "0.35rem", marginTop: "0.35rem" }}>
              <label className="muted small">
                Name
                <input
                  style={{ width: "100%", marginTop: "0.2rem" }}
                  value={customer.name}
                  onChange={(e) => setCustomer((prev) => ({ ...prev, name: e.target.value }))}
                  placeholder="Your name"
                />
              </label>
              <label className="muted small">
                Email
                <input
                  style={{ width: "100%", marginTop: "0.2rem" }}
                  value={customer.email}
                  onChange={(e) => setCustomer((prev) => ({ ...prev, email: e.target.value }))}
                  placeholder="you@example.com"
                  type="email"
                />
              </label>
              <label className="muted small">
                Phone
                <input
                  style={{ width: "100%", marginTop: "0.2rem" }}
                  value={customer.phone}
                  onChange={(e) => setCustomer((prev) => ({ ...prev, phone: e.target.value }))}
                  placeholder="+2547..."
                />
              </label>
              <label className="muted small">
                Address / delivery notes
                <textarea
                  style={{ width: "100%", marginTop: "0.2rem" }}
                  value={customer.address}
                  onChange={(e) => setCustomer((prev) => ({ ...prev, address: e.target.value }))}
                  placeholder="Estate, street, house/office, instructions"
                  rows={3}
                />
              </label>
              <label className="muted small" style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                <input
                  type="checkbox"
                  checked={customer.marketingOptIn}
                  onChange={(e) => setCustomer((prev) => ({ ...prev, marketingOptIn: e.target.checked }))}
                />
                Subscribe to offers and product news
              </label>
            </div>
            {error && (
              <p className="signin-error" style={{ marginTop: "0.4rem" }}>
                {error}
              </p>
            )}
            <div className="actions" style={{ display: "flex", flexDirection: "column", gap: "0.5rem", marginTop: "0.5rem" }}>
              {mailtoHref && (
                <a className="button full" href={mailtoHref}>
                  Send via email
                </a>
              )}
              {whatsappHref && (
                <a className="button ghost full" href={whatsappHref} target="_blank" rel="noreferrer">
                  Send via WhatsApp
                </a>
              )}
              {telegramHref && (
                <a className="button ghost full" href={telegramHref} target="_blank" rel="noreferrer">
                  Send via Telegram
                </a>
              )}
              <button className="button full" type="button" onClick={placeOrder} disabled={submitting}>
                {submitting ? "Placing..." : "Place order"}
              </button>
              <button className="button ghost full" type="button" onClick={() => copyOrderDetails(orderMessage)}>
                Copy order details
              </button>
              {!mailtoHref && !whatsappHref && !telegramHref && (
                <p className="muted small" style={{ margin: "0.25rem 0 0" }}>
                  Set order email/WhatsApp/Telegram in your environment to enable quick send buttons.
                </p>
              )}
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}
