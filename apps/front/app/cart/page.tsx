"use client";

import { useEffect, useMemo, useState } from "react";

type CartItem = { id: string; name: string; price: number; qty: number };

const orderEmail = process.env.NEXT_PUBLIC_ORDER_EMAIL;
const orderWhatsApp = process.env.NEXT_PUBLIC_ORDER_WHATSAPP;
const orderTelegram = process.env.NEXT_PUBLIC_ORDER_TELEGRAM;

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
    if (!id || !name || Number.isNaN(price) || Number.isNaN(qty)) continue;
    const key = `${id}-${price}`;
    const existing = merged.findIndex((item) => `${item.id}-${item.price}` === key);
    if (existing >= 0) {
      merged[existing].qty += Math.max(1, Math.round(qty));
    } else {
      merged.push({ id, name, price, qty: Math.max(1, Math.round(qty)) });
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

  return (
    <div className="card">
      <h2 style={{ marginTop: 0 }}>Cart</h2>
      <p className="muted" style={{ marginTop: 0 }}>
        Review your picks, adjust quantities, then place the order via email, WhatsApp, or Telegram.
      </p>
      {notice && <p className="signin-success">{notice}</p>}

      {!hydrated && <p className="muted">Loading your cart…</p>}

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
                      {formatKES(item.price)} each • Line total {formatKES(item.price * item.qty)}
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
                      −
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
