"use client";

import { useState, useEffect } from "react";

const apiBase = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

function staffLanding(_role: string) {
  return "/dashboard";
}

export default function SignInPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [forgotSent, setForgotSent] = useState(false);

  // Read straight off the URL rather than through useSearchParams, which would
  // opt this page out of prerendering and need a Suspense boundary around it
  // for the sake of one line of text.
  useEffect(() => {
    if (typeof window !== "undefined" && window.location.search.includes("expired=1")) {
      setError("Your session had expired, so you were signed out. Please sign in again.");
    }
  }, []);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const trimmedEmail = email.trim();
    if (!trimmedEmail || !password) {
      setError("Enter your email and password to continue.");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch(`${apiBase}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: trimmedEmail, password })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const detail = (data?.error?.message as string) ?? (data?.error as string) ?? "Unable to sign in.";
        throw new Error(detail);
      }

      const role = (data?.user?.role as string | undefined) ?? null;
      if (!role || role === "CUSTOMER") {
        throw new Error("This portal is for staff only. Contact your administrator.");
      }

      try {
        localStorage.setItem("mwalimu_token", data.token as string);
        localStorage.setItem("mwalimu_email", trimmedEmail);
        localStorage.setItem("mwalimu_role", role);
      } catch {
        // ignore
      }

      window.location.href = staffLanding(role);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Unable to sign in. Try again.");
    } finally {
      setLoading(false);
    }
  }

  async function handleForgot(event: React.MouseEvent<HTMLButtonElement>) {
    event.preventDefault();
    const trimmedEmail = email.trim();
    if (!trimmedEmail) {
      setError("Enter your email address first.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await fetch(`${apiBase}/auth/forgot`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: trimmedEmail })
      });
      setForgotSent(true);
    } catch {
      // fail silently — don't leak whether the email exists
      setForgotSent(true);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="signin-stack" style={{ maxWidth: 440, margin: "3rem auto" }}>
      <div className="signin-card">
        <div className="brand-lockup">Mwalimu Cosmetics</div>
        <h1 className="signin-title">Staff Login</h1>
        <p className="muted" style={{ margin: "0 0 1rem" }}>
          Sign in with your staff credentials to access the workspace.
        </p>

        <form onSubmit={handleSubmit} className="signin-form">
          <label className="input-group">
            <span>Email</span>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@mwalimucosmetics.com"
              autoComplete="email"
              required
            />
          </label>
          <label className="input-group">
            <span>Password</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              autoComplete="current-password"
              required
            />
            <button className="link-button" type="button" onClick={handleForgot} disabled={loading}>
              Forgot password?
            </button>
          </label>

          <button className="button full" type="submit" disabled={loading}>
            {loading ? "Signing in..." : "Sign in"}
          </button>
        </form>

        {error && <div className="signin-error">{error}</div>}
        {forgotSent && (
          <div className="signin-success">
            If that email is registered, reset instructions are on the way.
          </div>
        )}

        <div className="signin-foot">
          <p className="muted small">
            This portal is for authorised staff only.{" "}
            <a className="text-link" href="/">Back to home</a>
          </p>
        </div>
      </div>
    </div>
  );
}
