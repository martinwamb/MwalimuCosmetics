"use client";

import { useMemo, useState } from "react";

type Phase = "identifier" | "password" | "clock";

const apiBase = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

function isStaffRole(role: string | null) {
  return Boolean(role && role !== "CUSTOMER");
}

function friendlyRole(role: string | null) {
  if (!role) return "Role will load after lookup";
  switch (role) {
    case "ADMIN":
      return "Admin";
    case "ACCOUNTS":
      return "Accounts";
    case "SALES":
      return "Sales";
    case "CUSTOMER":
      return "Customer";
    default:
      return role;
  }
}

export default function SignInPage() {
  const [phase, setPhase] = useState<Phase>("identifier");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [exists, setExists] = useState(false);
  const [role, setRole] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [clockStatus, setClockStatus] = useState<string | null>(null);
  const [clockedIn, setClockedIn] = useState(false);
  const [forgotStatus, setForgotStatus] = useState<string | null>(null);

  const heading = useMemo(() => {
    if (phase === "identifier") return "Sign in or create account";
    if (phase === "clock") return "Verify identity to clock in";
    return exists ? "Enter your password" : "Create a password to finish";
  }, [phase, exists]);

  const subhead = useMemo(() => {
    if (phase === "identifier") {
      return "Enter your email to continue. New customers will create an account; staff are matched to their admin-created profile.";
    }
    if (phase === "clock") {
      return "Take a selfie or fingerprint scan to confirm it is you. This counts as your clock-in/out event.";
    }
    if (exists) return "Staff sign-ins unlock the workspace and biometric clock-in.";
    return "Create your customer account to track orders and delivery status.";
  }, [phase, exists]);

  function resetFlow() {
    setPhase("identifier");
    setPassword("");
    setError(null);
    setMessage(null);
    setRole(null);
    setExists(false);
    setClockStatus(null);
    setClockedIn(false);
    setForgotStatus(null);
  }

  async function handleLookup(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setMessage(null);
    setClockStatus(null);
    setForgotStatus(null);

    const trimmed = email.trim();
    if (!trimmed) {
      setError("Enter your email to continue.");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch(`${apiBase}/auth/identify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: trimmed })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error((data?.error as string) ?? "Could not look up that email.");
      }

      setExists(Boolean(data.exists));
      setRole(data.role ?? null);
      setPhase("password");
      setMessage(data.exists ? `We found your ${friendlyRole(data.role ?? null)} account.` : "New customer account. Set a password to continue.");
    } catch (err: any) {
      setError(err?.message ?? "Unable to continue. Try again.");
    } finally {
      setLoading(false);
    }
  }

  async function handlePassword(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setMessage(null);
    setClockStatus(null);
    setForgotStatus(null);

    const trimmedEmail = email.trim();
    if (!trimmedEmail) {
      setError("Email is missing. Go back and enter it again.");
      return;
    }
    if (!password) {
      setError("Enter your password to continue.");
      return;
    }

    setLoading(true);
    try {
      const path = exists ? "/auth/login" : "/auth/register";
      const res = await fetch(`${apiBase}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: trimmedEmail, password })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const detail = (data?.error?.message as string) ?? (data?.error as string) ?? "Unable to sign in.";
        throw new Error(detail);
      }

      const nextRole = (data?.user?.role as string | undefined) ?? role ?? (exists ? null : "CUSTOMER");
      setRole(nextRole ?? null);
      setExists(true);
      if (data?.token) {
        try {
          localStorage.setItem("mwalimu_token", data.token as string);
        } catch {
          // best-effort only
        }
      }

      setMessage(exists ? "Signed in successfully." : "Account created and signed in.");

      if (isStaffRole(nextRole ?? null)) {
        setPhase("clock");
        setClockStatus("Ready for biometric verification.");
      }
    } catch (err: any) {
      setError(err?.message ?? "Unable to sign in. Try again.");
    } finally {
      setLoading(false);
    }
  }

  function handleBiometricCapture(event: React.MouseEvent<HTMLButtonElement>) {
    event.preventDefault();
    setError(null);
    setMessage(null);
    setClockStatus("Capturing selfie / fingerprint...");
    // Placeholder for biometric SDK integration; simulate success.
    setTimeout(() => {
      if (!clockedIn) {
        setClockedIn(true);
        setClockStatus("Biometric match confirmed. Clocked in.");
        setMessage("Clock-in event recorded.");
      } else {
        setClockedIn(false);
        setClockStatus("Biometric match confirmed. Clocked out.");
        setMessage("Clock-out event recorded.");
      }
    }, 600);
  }

  async function handleForgot(event: React.MouseEvent<HTMLButtonElement>) {
    event.preventDefault();
    setError(null);
    setForgotStatus(null);
    setMessage(null);

    const trimmedEmail = email.trim();
    if (!trimmedEmail) {
      setError("Enter your email first so we can send reset instructions.");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch(`${apiBase}/auth/forgot`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: trimmedEmail })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error((data?.error as string) ?? "Could not start password reset.");
      }
      setForgotStatus(data?.message ?? "If that account exists, reset instructions are on the way.");
    } catch (err: any) {
      setError(err?.message ?? "Could not start password reset. Try again.");
    } finally {
      setLoading(false);
    }
  }

  const staffBadge = isStaffRole(role);

  return (
    <div className="signin-stack">
      <div className="signin-card">
        <div className="brand-lockup">Mwalimu Cosmetics</div>
        <h1 className="signin-title">{heading}</h1>
        <p className="muted" style={{ margin: "0 0 0.5rem" }}>
          {subhead}
        </p>

        <form onSubmit={phase === "identifier" ? handleLookup : handlePassword} className="signin-form">
          {phase !== "identifier" && (
            <div className="signin-identity">
              <div>
                <strong>{email}</strong>
                <div className="pill subtle">{friendlyRole(role)}</div>
              </div>
              <button type="button" className="link-button" onClick={resetFlow}>
                Change
              </button>
            </div>
          )}

          {phase === "identifier" ? (
            <label className="input-group">
              <span>Enter email</span>
              <input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="you@example.com"
                autoComplete="email"
              />
            </label>
          ) : (
            <label className="input-group">
              <span>Password</span>
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="********"
                autoComplete={exists ? "current-password" : "new-password"}
              />
              <button className="link-button" type="button" onClick={handleForgot}>
                Forgot password?
              </button>
            </label>
          )}

          <button className="button full" type="submit" disabled={loading}>
            {loading ? "Working..." : phase === "identifier" ? "Continue" : exists ? "Sign in" : "Create account"}
          </button>
        </form>

        {error && <div className="signin-error">{error}</div>}
        {message && <div className="signin-success">{message}</div>}
        {forgotStatus && <div className="signin-success">{forgotStatus}</div>}

        {phase === "identifier" && (
          <div className="signin-foot">
            <p className="muted small">By continuing, you agree to the workspace terms for staff and store terms for shoppers.</p>
          </div>
        )}
      </div>

      <div className="card signin-sidecard">
        <div className="hero-eyebrow" style={{ marginBottom: "0.3rem" }}>
          What happens after sign-in
        </div>
        <p className="muted" style={{ margin: 0 }}>
          Customers land on orders and delivery history. Staff land on their workspace and will be prompted to clock in with a selfie
          or fingerprint before work begins.
        </p>
        <div className="sidecard-grid">
          <div>
            <strong>Role from database</strong>
            <p className="muted" style={{ margin: "0.15rem 0 0" }}>
              {friendlyRole(role)}
            </p>
          </div>
          <div>
            <strong>Account type</strong>
            <p className="muted" style={{ margin: "0.15rem 0 0" }}>
              {exists ? "Existing profile" : "New customer will be created"}
            </p>
          </div>
          <div>
            <strong>Biometric clock-in</strong>
            <p className="muted" style={{ margin: "0.15rem 0 0" }}>
              {staffBadge ? "Shown after password for staff" : "Hidden for customers"}
            </p>
          </div>
        </div>
      </div>

      {phase === "clock" && staffBadge && (
        <div className="signin-card">
          <div className="hero-eyebrow" style={{ marginBottom: "0.25rem" }}>
            Staff clock-in (biometric)
          </div>
          <h2 style={{ margin: "0 0 0.3rem" }}>Finish with biometric check</h2>
          <p className="muted" style={{ marginTop: 0 }}>
            You are signed in as {friendlyRole(role)}. Capture a selfie or fingerprint to clock in before opening the workspace.
          </p>
          <div className="signin-identity" style={{ margin: "0.5rem 0" }}>
            <div>
              <strong>{email}</strong>
              <div className="pill subtle">Staff</div>
            </div>
            <button type="button" className="link-button" onClick={resetFlow}>
              Use another account
            </button>
          </div>
          <button className="button full" type="button" onClick={handleBiometricCapture} disabled={loading}>
            {clockedIn ? "Clock out with selfie / fingerprint" : "Clock in with selfie / fingerprint"}
          </button>
          {clockStatus && (
            <p className="muted" style={{ marginTop: "0.5rem" }}>
              {clockStatus}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
