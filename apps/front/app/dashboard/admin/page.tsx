"use client";

import { useCallback, useEffect, useState } from "react";

const apiBase = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

type Staff = {
  id: string;
  email: string;
  name: string | null;
  role: string;
  disabled: boolean;
  createdAt: string;
};

// What each role actually opens, in the words of the job rather than the words
// of the code. Somebody handing out a login should not have to read the route
// guards to find out what they are handing out.
const ROLES: { value: string; label: string; blurb: string }[] = [
  { value: "FRONTDESK", label: "Tickets & Screen", blurb: "The collection board and the photos on the shop screen. No figures." },
  { value: "SALES",     label: "Sales",            blurb: "The till, sales and the ticket board." },
  { value: "ACCOUNTS",  label: "Accounts",         blurb: "Everything except staff: analytics, stock, history, the day's takings." },
  { value: "ADMIN",     label: "Admin",            blurb: "All of the above, and this page." },
];

function roleLabel(role: string) {
  return ROLES.find(r => r.value === role)?.label ?? role;
}

export default function StaffPage() {
  const [staff, setStaff] = useState<Staff[]>([]);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [me, setMe] = useState<string | null>(null);

  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState("FRONTDESK");
  const [password, setPassword] = useState("");

  const token = typeof window !== "undefined" ? localStorage.getItem("mwalimu_token") : null;
  const auth = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

  const load = useCallback(async () => {
    const res = await fetch(`${apiBase}/auth/staff`, { headers: auth });
    if (!res.ok) { setNote("Could not load the staff list."); return; }
    const body = await res.json();
    setStaff(body.data ?? []);
  }, [token]);

  useEffect(() => {
    setMe(typeof window !== "undefined" ? localStorage.getItem("mwalimu_email") : null);
    load();
  }, [load]);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setNote(null);
    try {
      const res = await fetch(`${apiBase}/auth/staff`, {
        method: "POST",
        headers: auth,
        body: JSON.stringify({ email: email.trim(), name: name.trim() || undefined, role, password })
      });
      const body = await res.json();
      if (!res.ok) {
        setNote(typeof body.error === "string" ? body.error : "That did not work. Check the address and password.");
        return;
      }
      setNote(`${email.trim()} can now sign in as ${roleLabel(role)}.`);
      setEmail(""); setName(""); setPassword("");
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function patch(id: string, change: { role?: string; disabled?: boolean }) {
    setNote(null);
    const res = await fetch(`${apiBase}/auth/staff/${id}`, {
      method: "PATCH", headers: auth, body: JSON.stringify(change)
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setNote(typeof body.error === "string" ? body.error : "That change was refused.");
      return;
    }
    await load();
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
      <div>
        <h2 style={{ margin: 0, fontWeight: 800, letterSpacing: "-0.02em" }}>Staff</h2>
        <p className="muted" style={{ margin: 0 }}>
          Who has a login, and what it lets them do.
        </p>
      </div>

      {note && (
        <div style={{ border: "1px solid #e5e7eb", borderRadius: 8, padding: "0.75rem 1rem",
          background: "#fff", fontSize: "0.9rem" }}>{note}</div>
      )}

      <section style={{ border: "1px solid #e5e7eb", borderRadius: 8, padding: "1rem", background: "#fff" }}>
        <strong style={{ fontSize: "0.95rem" }}>Add a login</strong>
        <form onSubmit={add} style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginTop: "0.75rem" }}>
          <input className="filter-input" style={{ width: "16rem" }} type="email" required
            placeholder="Email address" value={email} onChange={e => setEmail(e.target.value)} />
          <input className="filter-input" style={{ width: "10rem" }}
            placeholder="Name (optional)" value={name} onChange={e => setName(e.target.value)} />
          <select className="filter-input" value={role} onChange={e => setRole(e.target.value)}>
            {ROLES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
          </select>
          <input className="filter-input" style={{ width: "12rem" }} type="text" required minLength={6}
            placeholder="First password" value={password} onChange={e => setPassword(e.target.value)} />
          <button type="submit" className="filter-input" disabled={busy}
            style={{ cursor: busy ? "wait" : "pointer", background: "none" }}>
            {busy ? "Adding..." : "Add"}
          </button>
        </form>
        <p className="muted" style={{ fontSize: "0.8rem", margin: "0.6rem 0 0" }}>
          {ROLES.find(r => r.value === role)?.blurb}
        </p>
        <p className="muted" style={{ fontSize: "0.78rem", margin: "0.4rem 0 0" }}>
          Tell them the first password in person, then have them change it with
          Forgot password on the sign-in page.
        </p>
      </section>

      <section style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
        <strong style={{ fontSize: "0.95rem" }}>Logins ({staff.length})</strong>
        {staff.length === 0 && <p className="muted" style={{ fontSize: "0.85rem" }}>Nobody yet.</p>}
        {staff.map(s => {
          const isMe = me != null && s.email === me;
          return (
            <div key={s.id} style={{
              border: "1px solid #e5e7eb", borderRadius: 8, padding: "0.75rem 1rem", background: "#fff",
              display: "flex", gap: "0.75rem", alignItems: "center", flexWrap: "wrap",
              opacity: s.disabled ? 0.55 : 1
            }}>
              <div style={{ flex: "1 1 14rem", minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: "0.9rem" }}>
                  {s.name || s.email}
                  {isMe && <span className="muted" style={{ fontWeight: 400 }}> — you</span>}
                  {s.disabled && <span style={{ fontWeight: 400, color: "#b91c1c" }}> — switched off</span>}
                </div>
                {s.name && <div className="muted" style={{ fontSize: "0.8rem" }}>{s.email}</div>}
              </div>

              <select className="filter-input" value={s.role} disabled={isMe}
                onChange={e => patch(s.id, { role: e.target.value })}
                title={isMe ? "You cannot change your own role" : undefined}>
                {ROLES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
              </select>

              <button type="button" className="filter-input" disabled={isMe}
                onClick={() => patch(s.id, { disabled: !s.disabled })}
                title={isMe ? "You cannot switch yourself off" : undefined}
                style={{ cursor: isMe ? "not-allowed" : "pointer", background: "none",
                  color: s.disabled ? "#065f46" : "#b91c1c", width: "7.5rem" }}>
                {s.disabled ? "Switch on" : "Switch off"}
              </button>
            </div>
          );
        })}
        <p className="muted" style={{ fontSize: "0.78rem", margin: "0.25rem 0 0" }}>
          Switching a login off keeps that person&rsquo;s sales, clockings and history &mdash; it
          only stops them signing in, and takes effect at once. You cannot change your own
          role or switch yourself off, so the shop cannot lock itself out.
        </p>
      </section>
    </div>
  );
}
