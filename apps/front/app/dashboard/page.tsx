"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

function friendlyRole(role: string | null) {
  switch (role) {
    case "ADMIN": return "Administrator";
    case "ACCOUNTS": return "Accounts";
    case "SALES": return "Sales";
    default: return role ?? "Staff";
  }
}

export default function DashboardPage() {
  const [email, setEmail] = useState<string | null>(null);
  const [role, setRole] = useState<string | null>(null);
  const router = useRouter();

  useEffect(() => {
    setEmail(localStorage.getItem("mwalimu_email"));
    setRole(localStorage.getItem("mwalimu_role"));
  }, []);

  function handleSignOut() {
    try {
      localStorage.removeItem("mwalimu_token");
      localStorage.removeItem("mwalimu_role");
      localStorage.removeItem("mwalimu_email");
    } catch {
      // ignore
    }
    router.push("/sign-in");
  }

  return (
    <div className="dash-single-root">
      <div className="dash-single-topbar">
        <span className="dash-single-brand">Mwalimu Cosmetics</span>
        <div className="dash-single-user">
          {email && <span className="dash-single-email">{email}</span>}
          <span className="dash-role-badge">{friendlyRole(role)}</span>
          <button type="button" className="button ghost" style={{ padding: "0.3rem 0.75rem", fontSize: "0.82rem" }} onClick={handleSignOut}>
            Sign out
          </button>
        </div>
      </div>
      <div className="dash-single-body">
        <div className="dash-single-card">
          <div className="dash-single-icon">🌿</div>
          <h1 className="dash-single-title">Coming Soon</h1>
          <p className="dash-single-body-text">
            The full workspace is under construction. Check back soon — everything will be ready shortly.
          </p>
          <div className="dash-single-meta">
            Signed in as <strong>{email ?? "—"}</strong> &middot; {friendlyRole(role)}
          </div>
        </div>
      </div>
    </div>
  );
}
