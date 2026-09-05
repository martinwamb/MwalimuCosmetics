"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";

const apiBase = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

// The page the reset email has been pointing at since the feature was first
// written. Until now it did not exist, and the link carried the email address
// rather than a token - so anyone could have reset anyone's password by editing
// the URL. The token now comes from the email and is checked server-side.
function ResetForm() {
  const params = useSearchParams();
  const token = params.get("token") ?? "";

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (password.length < 6) { setError("Use at least six characters."); return; }
    if (password !== confirm) { setError("Those two do not match."); return; }

    setBusy(true);
    try {
      const res = await fetch(`${apiBase}/auth/reset`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password })
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(typeof body.error === "string" ? body.error : "That did not work. Ask for a new link.");
        return;
      }
      setDone(true);
    } catch {
      setError("Could not reach the server. Try again in a moment.");
    } finally {
      setBusy(false);
    }
  }

  if (!token) {
    return (
      <p style={{ margin: 0 }}>
        This link is incomplete. Open the link from the email exactly as it was sent,
        or ask for a new one from the sign-in page.
      </p>
    );
  }

  if (done) {
    return (
      <div>
        <p style={{ margin: "0 0 1rem" }}>Your password has been changed.</p>
        <a href="/sign-in" style={{ fontWeight: 600 }}>Sign in</a>
      </div>
    );
  }

  return (
    <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
      <label style={{ display: "flex", flexDirection: "column", gap: "0.25rem", fontSize: "0.9rem" }}>
        New password
        <input type="password" value={password} required minLength={6} autoFocus
          onChange={e => setPassword(e.target.value)}
          style={{ padding: "0.6rem", border: "1px solid #d1d5db", borderRadius: 6 }} />
      </label>
      <label style={{ display: "flex", flexDirection: "column", gap: "0.25rem", fontSize: "0.9rem" }}>
        Type it again
        <input type="password" value={confirm} required minLength={6}
          onChange={e => setConfirm(e.target.value)}
          style={{ padding: "0.6rem", border: "1px solid #d1d5db", borderRadius: 6 }} />
      </label>

      {error && <p style={{ color: "#b91c1c", fontSize: "0.9rem", margin: 0 }}>{error}</p>}

      <button type="submit" disabled={busy}
        style={{ padding: "0.65rem", borderRadius: 6, border: "none", background: "#111827",
          color: "#fff", fontWeight: 600, cursor: busy ? "wait" : "pointer" }}>
        {busy ? "Saving..." : "Set new password"}
      </button>

      <p style={{ fontSize: "0.78rem", color: "#6b7280", margin: 0 }}>
        The link works once, and stops working an hour after it was sent.
      </p>
    </form>
  );
}

export default function ResetPasswordPage() {
  return (
    <main style={{ maxWidth: "22rem", margin: "4rem auto", padding: "0 1rem" }}>
      <h1 style={{ fontSize: "1.35rem", fontWeight: 800, margin: "0 0 1.25rem" }}>
        Set a new password
      </h1>
      {/* useSearchParams needs a Suspense boundary or the whole route opts out
          of static rendering and the build warns about it. */}
      <Suspense fallback={<p style={{ margin: 0 }}>Loading...</p>}>
        <ResetForm />
      </Suspense>
    </main>
  );
}
