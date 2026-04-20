"use client";

import { useSearchParams } from "next/navigation";
import { Suspense } from "react";

function ConfirmationContent() {
  const params = useSearchParams();
  const orderId = params?.get("order") ?? "";

  return (
    <div style={{ maxWidth: "520px", margin: "3rem auto", textAlign: "center" }}>
      <div style={{ fontSize: "4rem", marginBottom: "0.5rem" }}>🎉</div>
      <h1 style={{ fontWeight: 800, letterSpacing: "-0.02em", margin: "0 0 0.5rem" }}>Order confirmed!</h1>
      <p className="muted" style={{ margin: "0 0 1.5rem" }}>
        Thank you for shopping with Mwalimu Cosmetics. We have received your order and will process it shortly.
      </p>

      {orderId && (
        <div className="card" style={{ marginBottom: "1.5rem", textAlign: "left" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ color: "var(--muted)", fontWeight: 600 }}>Order ID</span>
            <span style={{ fontWeight: 800, fontFamily: "monospace" }}>{orderId}</span>
          </div>
        </div>
      )}

      <div className="card" style={{ marginBottom: "1.5rem", textAlign: "left", background: "#ecfdf5", border: "1px solid #a7f3d0" }}>
        <p style={{ margin: 0, color: "#065f46", fontSize: "0.9rem" }}>
          A confirmation has been sent to your email if you provided one. You can track your order status under <a href="/orders" style={{ color: "#065f46", fontWeight: 700, textDecoration: "underline" }}>My Orders</a>.
        </p>
      </div>

      <div style={{ display: "flex", gap: "0.75rem", justifyContent: "center", flexWrap: "wrap" }}>
        <a href="/" className="button" style={{ display: "inline-block" }}>Continue shopping</a>
        <a href="/orders" className="button ghost" style={{ display: "inline-block" }}>View my orders</a>
      </div>
    </div>
  );
}

export default function ConfirmationPage() {
  return (
    <Suspense fallback={null}>
      <ConfirmationContent />
    </Suspense>
  );
}
