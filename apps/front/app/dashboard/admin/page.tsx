"use client";

import { useCallback, useEffect, useState } from "react";

const apiBase = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

type Staff = {
  id: string;
  email: string;
  name: string | null;
  role: string;
  disabled: boolean;
  clockBoard: boolean;
  hasPin: boolean;
  createdAt: string;
};

type IssuedPin = { id: string; name: string; pin: string };

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

function errorText(body: any, fallback: string) {
  return typeof body?.error === "string" ? body.error : fallback;
}

// Names were typed on a shared tablet by whoever was standing at it, and the
// print window is this page's own origin.
function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" } as Record<string, string>)[c]);
}

// A sheet of slips to cut apart, one per person. Returns false when the
// browser blocked the window.
function printSlips(list: IssuedPin[]): boolean {
  const w = window.open("", "_blank", "width=800,height=900");
  if (!w) return false;
  const slips = list.map(p => `
    <div class="slip">
      <div class="name">${escapeHtml(p.name)}</div>
      <div class="pin">${escapeHtml(p.pin)}</div>
      <div class="hint">Your clock-in PIN. Tap your name on the shop tablet, then type it. Keep it to yourself.</div>
    </div>`).join("");
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Clock-in PINs</title><style>
    @page { margin: 12mm; }
    body { margin: 0; font-family: system-ui, -apple-system, "Segoe UI", sans-serif; color: #111; }
    .sheet { display: grid; grid-template-columns: 1fr 1fr; }
    .slip { border: 1px dashed #666; padding: 9mm 6mm; text-align: center; break-inside: avoid; }
    .name { font-size: 18pt; font-weight: 700; }
    .pin { font-size: 42pt; font-weight: 800; letter-spacing: 0.25em; margin: 3mm 0; font-variant-numeric: tabular-nums; }
    .hint { font-size: 9pt; color: #444; }
  </style></head><body><div class="sheet">${slips}</div></body></html>`);
  w.document.close();
  // Once printed, the sheet is not left sitting open in a tab.
  w.onafterprint = () => w.close();
  w.focus();
  w.print();
  return true;
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

  const [editing, setEditing] = useState<{ id: string; value: string } | null>(null);

  // PINs are shown once. The server stores each only as a keyed hash, so
  // nobody, admins included, can read one back; what these calls return is the
  // only copy. It lives in this page's state until somebody hides it, and never
  // in storage or a URL. A lost PIN is fixed with Reset PIN.
  const [shownPins, setShownPins] = useState<Record<string, string>>({});
  const [issued, setIssued] = useState<IssuedPin[] | null>(null);
  const [pinBusy, setPinBusy] = useState<string | null>(null);
  const [issuing, setIssuing] = useState(false);

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

  async function patch(id: string, change: { role?: string; disabled?: boolean; name?: string; clockBoard?: boolean }) {
    setNote(null);
    const res = await fetch(`${apiBase}/auth/staff/${id}`, {
      method: "PATCH", headers: auth, body: JSON.stringify(change)
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setNote(typeof body.error === "string" ? body.error : "That change was refused.");
      return false;
    }
    await load();
    return true;
  }

  async function saveName(id: string) {
    const value = editing?.id === id ? editing.value.trim() : "";
    if (value.length < 1 || value.length > 60) {
      setNote("A name needs between 1 and 60 characters.");
      return;
    }
    if (await patch(id, { name: value })) setEditing(null);
  }

  async function issuePin(s: Staff) {
    const label = s.name || s.email;
    if (s.hasPin && !window.confirm(`Reset the PIN for ${label}? Their old PIN stops working at once.`)) return;
    setNote(null);
    setPinBusy(s.id);
    try {
      const res = await fetch(`${apiBase}/auth/staff/${s.id}/pin`, { method: "POST", headers: auth });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || typeof body.pin !== "string") {
        setNote(errorText(body, "Could not issue a PIN."));
        return;
      }
      setShownPins(prev => ({ ...prev, [s.id]: body.pin }));
      // A reset also kills the PIN on the one-time sheet. Keep the sheet in
      // step, or a slip printed from it would hand over a dead PIN.
      setIssued(prev => prev ? prev.map(p => p.id === s.id ? { ...p, pin: body.pin } : p) : prev);
      await load();
    } catch {
      setNote("Could not issue a PIN. Try again.");
    } finally {
      setPinBusy(null);
    }
  }

  function hidePin(id: string) {
    setShownPins(prev => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }

  async function issueMissing() {
    setNote(null);
    setIssuing(true);
    try {
      const res = await fetch(`${apiBase}/auth/staff/pins/issue-missing`, { method: "POST", headers: auth });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !Array.isArray(body.data)) {
        setNote(errorText(body, "Could not issue the PINs."));
        return;
      }
      if (body.data.length === 0) setNote("Everybody on the clock board already has a PIN.");
      else setIssued(body.data);
      await load();
    } catch {
      setNote("Could not issue the PINs. Try again.");
    } finally {
      setIssuing(false);
    }
  }

  function printIssued() {
    if (issued && !printSlips(issued)) {
      setNote("The browser blocked the print window. Allow pop-ups for this page and press Print slips again.");
    }
  }

  function handedOut() {
    if (window.confirm("Hide the list? These PINs cannot be shown again.")) setIssued(null);
  }

  const missing = staff.filter(s => s.clockBoard && !s.disabled && !s.hasPin).length;

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

      <section style={{ border: "1px solid #e5e7eb", borderRadius: 8, padding: "1rem", background: "#fff",
        display: "flex", flexDirection: "column", gap: "0.6rem" }}>
        <strong style={{ fontSize: "0.95rem" }}>Clock-in PINs</strong>
        <p className="muted" style={{ fontSize: "0.8rem", margin: 0 }}>
          Everybody on the clock board taps their name on the shop tablet and types a 4-digit PIN.
          A PIN is shown once, when it is issued. Nobody can look one up later, so a forgotten
          PIN is fixed with Reset PIN on that person&rsquo;s row.
        </p>

        {!issued && (
          <div>
            <button type="button" className="filter-input" onClick={issueMissing}
              disabled={missing === 0 || issuing}
              style={{ cursor: missing === 0 ? "not-allowed" : issuing ? "wait" : "pointer", background: "none" }}>
              {issuing ? "Issuing..." : `Issue PINs to everyone without one (${missing})`}
            </button>
          </div>
        )}

        {issued && (
          <>
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr><th>Name</th><th>PIN</th></tr>
                </thead>
                <tbody>
                  {issued.map(p => (
                    <tr key={p.id}>
                      <td>{p.name}</td>
                      <td style={{ fontSize: "1.25rem", fontWeight: 700, letterSpacing: "0.2em",
                        fontVariantNumeric: "tabular-nums" }}>{p.pin}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
              <button type="button" className="filter-input" onClick={printIssued}
                style={{ cursor: "pointer", background: "none" }}>
                Print slips
              </button>
              <button type="button" className="filter-input" onClick={handedOut}
                style={{ cursor: "pointer", background: "none" }}>
                I have handed these out &mdash; hide
              </button>
            </div>
          </>
        )}
      </section>

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
          const label = s.name || s.email;
          const shown = shownPins[s.id];
          const renaming = editing?.id === s.id;
          return (
            <div key={s.id} style={{
              border: "1px solid #e5e7eb", borderRadius: 8, padding: "0.75rem 1rem", background: "#fff",
              display: "flex", gap: "0.75rem", alignItems: "center", flexWrap: "wrap",
              opacity: s.disabled ? 0.55 : 1
            }}>
              <div style={{ flex: "1 1 14rem", minWidth: 0 }}>
                {renaming ? (
                  <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap" }}>
                    <input className="filter-input" autoFocus maxLength={60} placeholder="Name"
                      value={editing.value}
                      onChange={e => setEditing({ id: s.id, value: e.target.value })}
                      onKeyDown={e => {
                        if (e.key === "Enter") saveName(s.id);
                        if (e.key === "Escape") setEditing(null);
                      }}
                      style={{ flex: "1 1 10rem", minWidth: 0 }} />
                    <button type="button" className="filter-input" onClick={() => saveName(s.id)}
                      disabled={editing.value.trim().length === 0}
                      style={{ cursor: "pointer", background: "none" }}>
                      Save
                    </button>
                    <button type="button" className="filter-input" onClick={() => setEditing(null)}
                      style={{ cursor: "pointer", background: "none" }}>
                      Cancel
                    </button>
                  </div>
                ) : (
                  <div style={{ fontWeight: 600, fontSize: "0.9rem" }}>
                    <button type="button" title="Change the name"
                      onClick={() => setEditing({ id: s.id, value: s.name ?? "" })}
                      style={{ background: "none", border: "none", padding: 0, font: "inherit",
                        color: "inherit", cursor: "text", textAlign: "left",
                        borderBottom: "1px dotted #9ca3af" }}>
                      {label}
                    </button>
                    {isMe && <span className="muted" style={{ fontWeight: 400 }}> — you</span>}
                    {s.disabled && <span style={{ fontWeight: 400, color: "#b91c1c" }}> — switched off</span>}
                  </div>
                )}
                {(s.name || renaming) && <div className="muted" style={{ fontSize: "0.8rem" }}>{s.email}</div>}
              </div>

              <label style={{ display: "flex", alignItems: "center", gap: "0.35rem", fontSize: "0.85rem",
                cursor: "pointer", whiteSpace: "nowrap" }}>
                <input type="checkbox" checked={s.clockBoard}
                  onChange={e => patch(s.id, { clockBoard: e.target.checked })} />
                On clock board
              </label>

              <button type="button" className="filter-input" onClick={() => issuePin(s)}
                disabled={pinBusy === s.id}
                style={{ cursor: pinBusy === s.id ? "wait" : "pointer", background: "none", width: "7rem" }}>
                {pinBusy === s.id ? "..." : s.hasPin ? "Reset PIN" : "Issue PIN"}
              </button>

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

              {shown && (
                <div style={{ flexBasis: "100%", display: "flex", alignItems: "center", gap: "0.75rem",
                  flexWrap: "wrap", border: "1px solid #a7f3d0", background: "#ecfdf5",
                  borderRadius: 8, padding: "0.5rem 0.75rem" }}>
                  <span style={{ fontSize: "0.85rem" }}>PIN for {label}:</span>
                  <strong style={{ fontSize: "1.5rem", letterSpacing: "0.2em",
                    fontVariantNumeric: "tabular-nums" }}>{shown}</strong>
                  <span className="muted" style={{ fontSize: "0.8rem", flex: "1 1 10rem" }}>
                    Shown this once. Tell them in person.
                  </span>
                  <button type="button" className="filter-input" onClick={() => hidePin(s.id)}
                    style={{ cursor: "pointer", background: "none" }}>
                    Hide
                  </button>
                </div>
              )}
            </div>
          );
        })}
        <p className="muted" style={{ fontSize: "0.78rem", margin: "0.25rem 0 0" }}>
          Switching a login off keeps that person&rsquo;s sales, clockings and history &mdash; it
          only stops them signing in, and takes effect at once. You cannot change your own
          role or switch yourself off, so the shop cannot lock itself out. Taking somebody
          off the clock board only hides their name on the tablet; their shifts stay.
        </p>
      </section>
    </div>
  );
}
