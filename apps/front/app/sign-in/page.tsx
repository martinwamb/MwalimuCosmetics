"use client";

import { useMemo, useState } from "react";

const staffRoles = ["Accounts", "Sales", "Admin", "Store", "Delivery"];

const customerTiles = [
  { title: "Orders and delivery", detail: "See past orders, live delivery statuses, and start returns." },
  { title: "Reorder fast", detail: "Buy again from saved routines and recent carts." },
  { title: "Language and region", detail: "Switch language, currency notes, and delivery windows." }
];

const staffTiles = [
  { title: "Accounts", detail: "Invoices, receivables, payouts, and statements." },
  { title: "Sales", detail: "Targets, funnels, and counter sales performance." },
  { title: "Admin", detail: "Permissions, staff invites, and locations." },
  { title: "Store", detail: "Inventory, counts, put-aways, and price labels." },
  { title: "Delivery", detail: "Routes, drop confirmations, and POD uploads." }
];

const clockSteps = [
  { title: "Clock in", detail: "Secure tap with WebAuthn, OTP, or staff PIN." },
  { title: "Add context", detail: "Shift note, location, and counter or route selected." },
  { title: "Clock out", detail: "Capture break time, route completion, or handover." }
];

export default function SignInPage() {
  const [role, setRole] = useState<"customer" | "staff">("customer");
  const [staffRole, setStaffRole] = useState<string>(staffRoles[0]);

  const staffHeadline = useMemo(() => {
    switch (staffRole) {
      case "Accounts":
        return "Accounts sees receivables, payouts, and approvals.";
      case "Sales":
        return "Sales sees counters, top SKUs, and discounts ready to apply.";
      case "Admin":
        return "Admin manages locations, access, and security.";
      case "Store":
        return "Store tracks stock, counts, and pick-pack updates.";
      case "Delivery":
        return "Delivery views routes, POD, and cash on delivery totals.";
      default:
        return "Staff workspaces adapt to the role you select.";
    }
  }, [staffRole]);

  return (
    <div className="signin-shell">
      <div className="signin-panel">
        <div className="hero-eyebrow" style={{ marginBottom: "0.45rem" }}>
          Sign in
        </div>
        <h2 style={{ margin: "0 0 0.35rem" }}>Welcome back to Mwalimu</h2>
        <p className="muted" style={{ marginTop: 0 }}>
          Choose whether you are shopping or working today. Everyone keeps Home, language, sign in, orders, and cart at
          the top bar.
        </p>

        <div className="role-tabs">
          <button
            className={`role-tab ${role === "customer" ? "active" : ""}`}
            onClick={() => setRole("customer")}
            type="button"
          >
            Customer
          </button>
          <button
            className={`role-tab ${role === "staff" ? "active" : ""}`}
            onClick={() => setRole("staff")}
            type="button"
          >
            Staff
          </button>
        </div>

        <div className="form-grid">
          <label className="input-group">
            <span>Email</span>
            <input type="email" placeholder="you@example.com" />
          </label>
          <label className="input-group">
            <span>Password</span>
            <input type="password" placeholder="********" />
          </label>
          <label className="input-group">
            <span>Language</span>
            <select defaultValue="EN">
              <option>EN</option>
              <option>SW</option>
              <option>FR</option>
            </select>
          </label>
          {role === "staff" && (
            <label className="input-group">
              <span>Team</span>
              <select value={staffRole} onChange={(event) => setStaffRole(event.target.value)}>
                {staffRoles.map((item) => (
                  <option key={item}>{item}</option>
                ))}
              </select>
            </label>
          )}
        </div>

        <button className="button full" style={{ marginTop: "0.75rem" }}>
          Continue
        </button>
        <p className="muted" style={{ marginTop: "0.65rem" }}>
          Customers will see past orders and delivery statuses. Staff will land on their workspace and clock-in flow.
        </p>
      </div>

      <div className="signin-right">
        {role === "customer" ? (
          <div className="card highlight-card">
            <div className="hero-eyebrow" style={{ marginBottom: "0.4rem" }}>
              Customer view
            </div>
            <h3 style={{ margin: 0 }}>Shopping with your history in view</h3>
            <p className="muted" style={{ marginTop: "0.35rem" }}>
              See every past order, delivery promise, and reorder option alongside the storefront.
            </p>
            <div className="feature-grid">
              {customerTiles.map((tile) => (
                <div key={tile.title} className="feature-chip">
                  <strong>{tile.title}</strong>
                  <p className="muted" style={{ margin: "0.25rem 0 0" }}>
                    {tile.detail}
                  </p>
                </div>
              ))}
            </div>
            <div className="timeline">
              <div className="timeline-row">
                <span className="dot" />
                <div>
                  <strong>Order #MC-2041</strong>
                  <p className="muted" style={{ margin: 0 }}>
                    Out for delivery · Today 3:30 PM
                  </p>
                </div>
                <span className="status-chip">Live</span>
              </div>
              <div className="timeline-row">
                <span className="dot" />
                <div>
                  <strong>Order #MC-1987</strong>
                  <p className="muted" style={{ margin: 0 }}>
                    Delivered · 2 days ago
                  </p>
                </div>
                <span className="status-chip ghost">Reorder</span>
              </div>
            </div>
          </div>
        ) : (
          <>
            <div className="card highlight-card">
              <div className="hero-eyebrow" style={{ marginBottom: "0.4rem" }}>
                Staff workspace
              </div>
              <h3 style={{ margin: 0 }}>Role-based console after sign-in</h3>
              <p className="muted" style={{ marginTop: "0.35rem" }}>
                {staffHeadline}
              </p>
              <div className="feature-grid">
                {staffTiles.map((tile) => (
                  <div key={tile.title} className="feature-chip">
                    <strong>{tile.title}</strong>
                    <p className="muted" style={{ margin: "0.25rem 0 0" }}>
                      {tile.detail}
                    </p>
                  </div>
                ))}
              </div>
            </div>
            <div className="card clock-card">
              <div className="hero-eyebrow" style={{ marginBottom: "0.4rem" }}>
                Staff clock-in (hidden from customers)
              </div>
              <h3 style={{ margin: "0 0 0.35rem" }}>Clock in like you would on Jibble</h3>
              <p className="muted" style={{ marginTop: 0 }}>
                After staff sign-in, the platform prompts for clock-in before opening the workspace.
              </p>
              <div className="clock-steps">
                {clockSteps.map((step) => (
                  <div key={step.title} className="clock-step">
                    <strong>{step.title}</strong>
                    <p className="muted" style={{ margin: 0 }}>
                      {step.detail}
                    </p>
                  </div>
                ))}
              </div>
              <div className="clock-status">
                <div>
                  <strong>Next action</strong>
                  <p className="muted" style={{ margin: 0 }}>
                    Clock in · Store floor · 09:02 AM
                  </p>
                </div>
                <button className="button">Clock in</button>
              </div>
              <div className="clock-log">
                <div className="clock-log-row">
                  <span className="dot" />
                  <div>
                    <strong>08:51 AM</strong>
                    <p className="muted" style={{ margin: 0 }}>
                      Arrived · Location verified
                    </p>
                  </div>
                </div>
                <div className="clock-log-row">
                  <span className="dot" />
                  <div>
                    <strong>Yesterday</strong>
                    <p className="muted" style={{ margin: 0 }}>
                      Clocked out · Delivery route KE-04
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
