"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";

const apiBase = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

/**
 * A customer's own receipt, opened from the QR on their collection slip.
 *
 * No sign-in, deliberately. Somebody who has just been handed a paper receipt
 * at a counter is not going to make an account to look at it again, and asking
 * them to would mean the QR may as well not be there.
 *
 * What makes that safe is the token in the URL: 22 characters of a 57-character
 * alphabet, about 128 bits, generated on the till. The receipt NUMBER is
 * useless as an address — receipt numbers run in a visible sequence, so anyone
 * holding one slip could walk backwards through the day's sales.
 *
 * The server returns the same 404 for a token that is unknown, malformed or the
 * wrong length, so this page cannot tell the difference either, and neither can
 * anybody probing it.
 */

type Item = { sku: string; name: string; qty: number; price: number; total: number };
type Receipt = {
  receiptno: string;
  customer: string | null;
  servedBy: string | null;
  ticketCode: string;
  soldAt: string;
  total: number;
  lineCount: number;
  items: Item[];
};

function money(n: number) {
  return Number(n ?? 0).toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function when(iso: string) {
  if (!iso) return "";
  return new Date(iso).toLocaleString("en-KE", {
    year: "numeric", month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit", hour12: true
  });
}

export default function ReceiptPage() {
  const params = useParams();
  const token = String(params?.token ?? "");

  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "missing" | "error">("loading");

  useEffect(() => {
    if (!token) { setState("missing"); return; }

    fetch(`${apiBase}/tickets/receipt/${encodeURIComponent(token)}`)
      .then(r => {
        if (r.status === 404) return null;
        if (!r.ok) throw new Error(String(r.status));
        return r.json();
      })
      .then(d => {
        if (!d) { setState("missing"); return; }
        setReceipt(d.data);
        setState("ready");
      })
      .catch(() => setState("error"));
  }, [token]);

  if (state === "loading") {
    return <Shell><p style={{ textAlign: "center", color: "#6b7280" }}>Loading your receipt…</p></Shell>;
  }

  if (state === "missing") {
    return (
      <Shell>
        <h1 style={{ fontSize: "1.15rem", margin: "0 0 0.5rem" }}>Receipt not found</h1>
        <p style={{ color: "#6b7280", fontSize: "0.92rem", margin: 0 }}>
          This link may have been mistyped, or it may belong to a sale that is no
          longer available. The code on your slip is the whole link — try scanning
          it again.
        </p>
      </Shell>
    );
  }

  if (state === "error" || !receipt) {
    return (
      <Shell>
        <h1 style={{ fontSize: "1.15rem", margin: "0 0 0.5rem" }}>Something went wrong</h1>
        <p style={{ color: "#6b7280", fontSize: "0.92rem", margin: 0 }}>
          Your receipt could not be loaded just now. Please try again in a moment.
        </p>
      </Shell>
    );
  }

  return (
    <Shell>
      <div style={{ textAlign: "center", marginBottom: "1rem" }}>
        <div style={{ fontWeight: 800, letterSpacing: "0.02em" }}>JUSTANN INVESTMENT LTD</div>
        <div style={{ fontSize: "0.8rem", color: "#6b7280" }}>Mwalimu Cosmetics</div>
      </div>

      <dl style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "0.2rem 0.75rem",
        fontSize: "0.86rem", margin: "0 0 1rem" }}>
        <dt style={{ color: "#6b7280" }}>Receipt</dt><dd style={{ margin: 0, fontWeight: 600 }}>{receipt.receiptno}</dd>
        <dt style={{ color: "#6b7280" }}>Date</dt><dd style={{ margin: 0 }}>{when(receipt.soldAt)}</dd>
        {receipt.customer && (<><dt style={{ color: "#6b7280" }}>Customer</dt><dd style={{ margin: 0 }}>{receipt.customer}</dd></>)}
        {receipt.servedBy && (<><dt style={{ color: "#6b7280" }}>Served by</dt><dd style={{ margin: 0 }}>{receipt.servedBy}</dd></>)}
        <dt style={{ color: "#6b7280" }}>Ticket</dt><dd style={{ margin: 0 }}>{receipt.ticketCode}</dd>
      </dl>

      {/* A receipt is a column of figures, so this is the one place a table
          earns its keep and the numbers are aligned right and tabular. */}
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.86rem" }}>
          <thead>
            <tr style={{ borderBottom: "1px solid #111827" }}>
              <th style={{ textAlign: "left", padding: "0.35rem 0.25rem" }}>Item</th>
              <th style={{ textAlign: "right", padding: "0.35rem 0.25rem", width: "3.5rem" }}>Qty</th>
              <th style={{ textAlign: "right", padding: "0.35rem 0.25rem", width: "5.5rem" }}>Price</th>
              <th style={{ textAlign: "right", padding: "0.35rem 0.25rem", width: "6rem" }}>Amount</th>
            </tr>
          </thead>
          <tbody>
            {receipt.items.length === 0 && (
              <tr><td colSpan={4} style={{ padding: "0.75rem 0.25rem", color: "#6b7280" }}>
                The lines for this sale are not available.
              </td></tr>
            )}
            {receipt.items.map((it, i) => (
              <tr key={i} style={{ borderBottom: "1px solid #f3f4f6" }}>
                <td style={{ padding: "0.35rem 0.25rem" }}>{it.name}</td>
                <td style={{ padding: "0.35rem 0.25rem", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{it.qty}</td>
                <td style={{ padding: "0.35rem 0.25rem", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{money(it.price)}</td>
                <td style={{ padding: "0.35rem 0.25rem", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{money(it.total)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr style={{ borderTop: "2px solid #111827" }}>
              <td colSpan={3} style={{ padding: "0.5rem 0.25rem", fontWeight: 700 }}>Total</td>
              <td style={{ padding: "0.5rem 0.25rem", textAlign: "right", fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>
                KES {money(receipt.total)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      <p style={{ fontSize: "0.76rem", color: "#6b7280", marginTop: "1rem", textAlign: "center" }}>
        Prices inclusive of VAT where applicable. Goods once sold are not refundable.
      </p>

      <button type="button" onClick={() => window.print()}
        style={{
          marginTop: "1rem", width: "100%", padding: "0.6rem", borderRadius: 6,
          border: "1px solid #111827", background: "#111827", color: "#fff",
          fontWeight: 600, cursor: "pointer", fontFamily: "inherit"
        }}>
        Save or print
      </button>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ minHeight: "60vh", display: "flex", justifyContent: "center", padding: "1.5rem 1rem" }}>
      <div style={{
        width: "100%", maxWidth: 460, background: "#fff", borderRadius: 10,
        border: "1px solid #e5e7eb", padding: "1.25rem"
      }}>
        {children}
      </div>
    </div>
  );
}
