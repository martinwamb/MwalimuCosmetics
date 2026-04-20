"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

const apiBase = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

type CartItem = { id: string; name: string; slug?: string; price: number; qty: number; imageUrl?: string };

function fmt(n: number) {
  return new Intl.NumberFormat("en-KE", { style: "currency", currency: "KES", maximumFractionDigits: 0 }).format(n);
}

export default function CheckoutPage() {
  const router = useRouter();
  const [cart, setCart] = useState<CartItem[]>([]);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [marketingOptIn, setMarketingOptIn] = useState(false);
  const [payMethod, setPayMethod] = useState<"CARD" | "MOBILE_MONEY" | "CASH" | "BANK_TRANSFER">("MOBILE_MONEY");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem("mwalimu_cart");
      const parsed = raw ? JSON.parse(raw) : [];
      setCart(Array.isArray(parsed) ? parsed : []);
    } catch {
      setCart([]);
    }

    // Pre-fill from saved session
    const savedEmail = localStorage.getItem("mwalimu_email") ?? "";
    if (savedEmail) setEmail(savedEmail);
  }, []);

  const subtotal = cart.reduce((s, i) => s + i.price * i.qty, 0);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (cart.length === 0) return;
    if (!name.trim()) { setError("Please enter your name."); return; }
    setSubmitting(true);
    setError(null);

    const token = localStorage.getItem("mwalimu_token");
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (token) headers.Authorization = `Bearer ${token}`;

    try {
      const res = await fetch(`${apiBase}/orders`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          channel: "ONLINE",
          paymentMethod: payMethod,
          items: cart.map((i) => ({
            productId: i.id,
            name: i.name,
            slug: i.slug,
            qty: i.qty,
            unitPrice: i.price,
          })),
          customer: {
            name: name.trim(),
            email: email.trim() || undefined,
            phone: phone.trim() || undefined,
            address: address.trim() || undefined,
            marketingOptIn,
          },
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error ?? "Order failed");

      localStorage.removeItem("mwalimu_cart");
      window.dispatchEvent(new Event("mwalimu-cart-updated"));

      const orderId = data?.data?.id ?? "";
      router.push(`/checkout/confirmation?order=${encodeURIComponent(orderId)}`);
    } catch (err: any) {
      setError(err?.message ?? "Order failed. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (cart.length === 0) {
    return (
      <div style={{ textAlign: "center", padding: "4rem 1rem" }}>
        <h2>Your cart is empty</h2>
        <a href="/" className="button" style={{ display: "inline-block", marginTop: "1rem" }}>Continue shopping</a>
      </div>
    );
  }

  return (
    <div style={{ display: "grid", gridTemplateColumns: "minmax(300px, 1fr) minmax(280px, 420px)", gap: "1.5rem", margin: "1.5rem 0", alignItems: "start" }}>
      {/* Form */}
      <div className="card">
        <h2 style={{ margin: "0 0 1rem", fontWeight: 800, letterSpacing: "-0.02em" }}>Checkout</h2>
        <form onSubmit={submit} style={{ display: "grid", gap: "0.75rem" }}>
          <h3 style={{ margin: "0 0 0.25rem", fontSize: "0.9rem", textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--muted)", fontWeight: 700 }}>Your details</h3>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.65rem" }}>
            <label className="input-group">
              <span>Full name *</span>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Jane Wanjiru" required />
            </label>
            <label className="input-group">
              <span>Phone</span>
              <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="0712 345 678" />
            </label>
          </div>

          <label className="input-group">
            <span>Email</span>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="jane@example.com" />
          </label>

          <label className="input-group">
            <span>Delivery address</span>
            <input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Street, town, county" />
          </label>

          <label style={{ display: "flex", gap: "0.5rem", alignItems: "center", cursor: "pointer" }}>
            <input type="checkbox" checked={marketingOptIn} onChange={(e) => setMarketingOptIn(e.target.checked)} />
            <span style={{ fontSize: "0.88rem" }}>Keep me updated with offers and new arrivals</span>
          </label>

          <h3 style={{ margin: "0.5rem 0 0.25rem", fontSize: "0.9rem", textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--muted)", fontWeight: 700 }}>Payment method</h3>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem" }}>
            {(["MOBILE_MONEY", "CARD", "CASH", "BANK_TRANSFER"] as const).map((m) => (
              <label
                key={m}
                style={{
                  display: "flex", alignItems: "center", gap: "0.5rem", padding: "0.7rem",
                  border: `2px solid ${payMethod === m ? "#b18a43" : "var(--border)"}`,
                  borderRadius: "10px", cursor: "pointer",
                  background: payMethod === m ? "#fef3c7" : "#f8fafc",
                  fontWeight: 700, fontSize: "0.88rem",
                }}
              >
                <input type="radio" name="payMethod" value={m} checked={payMethod === m} onChange={() => setPayMethod(m)} style={{ display: "none" }} />
                {m === "MOBILE_MONEY" ? "M-Pesa" : m === "BANK_TRANSFER" ? "Bank Transfer" : m.charAt(0) + m.slice(1).toLowerCase()}
              </label>
            ))}
          </div>

          {payMethod === "MOBILE_MONEY" && (
            <div className="card" style={{ background: "#ecfdf5", border: "1px solid #a7f3d0", padding: "0.75rem" }}>
              <p style={{ margin: 0, fontSize: "0.88rem", color: "#065f46" }}>
                After placing your order, you will receive an M-Pesa STK push to the phone number above. Complete the payment to confirm your order.
              </p>
            </div>
          )}

          {error && <div className="signin-error">{error}</div>}

          <button className="button full" type="submit" disabled={submitting} style={{ marginTop: "0.5rem", fontSize: "1rem", padding: "0.85rem" }}>
            {submitting ? "Placing order…" : `Place order · ${fmt(subtotal)}`}
          </button>
        </form>
      </div>

      {/* Order summary */}
      <div className="card" style={{ position: "sticky", top: "1rem" }}>
        <h3 style={{ margin: "0 0 0.75rem", fontWeight: 800 }}>Order summary</h3>
        <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", marginBottom: "0.75rem" }}>
          {cart.map((item) => (
            <div key={item.id} style={{ display: "flex", justifyContent: "space-between", gap: "0.5rem", fontSize: "0.9rem" }}>
              <span>{item.name} <span style={{ color: "var(--muted)" }}>× {item.qty}</span></span>
              <span style={{ fontWeight: 700 }}>{fmt(item.price * item.qty)}</span>
            </div>
          ))}
        </div>
        <div style={{ borderTop: "2px solid var(--border)", paddingTop: "0.75rem", display: "flex", justifyContent: "space-between" }}>
          <span style={{ fontWeight: 700 }}>Total</span>
          <span style={{ fontWeight: 800, fontSize: "1.2rem" }}>{fmt(subtotal)}</span>
        </div>
        <a href="/cart" style={{ display: "block", textAlign: "center", marginTop: "0.75rem", color: "var(--teal)", fontWeight: 700, fontSize: "0.88rem" }}>← Edit cart</a>
      </div>
    </div>
  );
}
