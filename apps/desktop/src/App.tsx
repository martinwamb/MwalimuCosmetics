import { useEffect, useState } from "react";
import { api, type Check, type User } from "./api";
import { Dashboard, Items, Sales, Suppliers, Settings } from "./screens";
import { PointOfSale, Reprint } from "./pos";

type Screen = "dashboard" | "pos" | "reprint" | "items" | "sales" | "suppliers" | "settings";

/**
 * Screens are gated on the same per-form rights FumasV5 uses, so a cashier
 * sees what a cashier saw. Settings is always reachable: without it, a
 * machine that cannot connect could never be pointed at the right server.
 */
const SCREENS: Array<{ id: Screen; label: string; form: string | null }> = [
  { id: "dashboard", label: "Dashboard", form: null },
  { id: "pos",       label: "Sell",          form: "FPOS" },
  { id: "reprint",   label: "Reprint",       form: "FPosList" },
  { id: "items",     label: "Items & stock", form: "Fitemlist" },
  { id: "sales",     label: "Sales",         form: "FPosList" },
  { id: "suppliers", label: "Suppliers",     form: "FPrepayment_creditors" },
  { id: "settings",  label: "Settings",      form: null },
];

function Login({ onSignedIn }: { onSignedIn: (user: User) => void }) {
  const [usercode, setUsercode] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [checks, setChecks] = useState<Check[] | null>(null);
  const [showSettings, setShowSettings] = useState(false);

  useEffect(() => {
    api.selfCheck()
      .then(r => setChecks(r.checks))
      .catch(e => setError(String(e.message ?? e)));
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      const { user } = await api.auth.login(usercode.trim(), password);
      onSignedIn(user);
    } catch (err: any) {
      setError(String(err.message ?? err));
    } finally { setBusy(false); }
  };

  const reachable = checks?.find(c => c.name === "Database reachable")?.ok ?? false;

  if (showSettings) {
    return (
      <div className="app">
        <div className="main" style={{ maxWidth: 760, margin: "0 auto" }}>
          <button onClick={() => setShowSettings(false)} style={{ marginBottom: "1rem" }}>
            ← Back to sign in
          </button>
          <Settings />
        </div>
      </div>
    );
  }

  return (
    <div className="login">
      <form className="login-card" onSubmit={submit}>
        <h1>Mwalimu Cosmetics</h1>
        <p className="sub">Sign in with your usual FumasV5 username and password.</p>

        {checks && (
          <ul className="checks">
            {checks.map(c => (
              <li key={c.name}>
                <span className={`mark ${c.ok ? "ok" : "no"}`}>{c.ok ? "✓" : "✕"}</span>
                <span>{c.name} <span className="muted">— {c.detail}</span></span>
              </li>
            ))}
          </ul>
        )}

        {error && <div className="error">{error}</div>}

        <div className="field">
          <label>Username</label>
          <input value={usercode} onChange={e => setUsercode(e.target.value)} autoFocus />
        </div>
        <div className="field">
          <label>Password</label>
          <input type="password" value={password} onChange={e => setPassword(e.target.value)} />
        </div>

        <button className="primary" type="submit" disabled={busy || !reachable} style={{ width: "100%" }}>
          {busy ? "Signing in…" : "Sign in"}
        </button>

        {!reachable && checks && (
          <p className="muted" style={{ fontSize: "0.83rem", marginTop: "0.9rem" }}>
            The database cannot be reached from this machine, so signing in is not possible yet.{" "}
            <button type="button" onClick={() => setShowSettings(true)}
                    style={{ padding: "0.1rem 0.4rem" }}>Open settings</button>
          </p>
        )}
      </form>
    </div>
  );
}

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [screen, setScreen] = useState<Screen>("dashboard");
  const [allowed, setAllowed] = useState<Set<string>>(new Set());
  const [writesEnabled, setWritesEnabled] = useState(false);

  useEffect(() => {
    if (!user) return;
    api.selfCheck().then(r => setWritesEnabled(r.writesEnabled)).catch(() => undefined);

    // Ask about each gated screen rather than assuming; rights come only from
    // the rights table, with no special case for any particular username.
    Promise.all(
      SCREENS.filter(s => s.form).map(async s => {
        try {
          const r = await api.auth.rights(s.form!);
          return r.view ? s.id : null;
        } catch { return null; }
      }),
    ).then(ids => setAllowed(new Set(ids.filter(Boolean) as string[])));
  }, [user]);

  if (!user) return <Login onSignedIn={setUser} />;

  const visible = SCREENS.filter(s => s.form === null || allowed.has(s.id));

  const signOut = async () => {
    await api.auth.logout().catch(() => undefined);
    setUser(null);
    setScreen("dashboard");
  };

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <h1>Mwalimu Cosmetics</h1>
          <small>{writesEnabled ? "Read & write" : "Read only"}</small>
        </div>

        <nav className="nav">
          {visible.map(s => (
            <button key={s.id}
                    className={screen === s.id ? "active" : ""}
                    onClick={() => setScreen(s.id)}>
              {s.label}
            </button>
          ))}
        </nav>

        <div className="userbox">
          <div><strong>{user.username}</strong></div>
          <div className="muted" style={{ fontSize: "0.78rem", marginBottom: "0.5rem" }}>
            {user.usercode}{user.locations.length ? ` · ${user.locations.join(", ")}` : ""}
          </div>
          <button onClick={signOut} style={{ width: "100%" }}>Sign out</button>
        </div>
      </aside>

      <main className="main">
        {screen === "dashboard" && <Dashboard />}
        {screen === "pos"       && <PointOfSale writesEnabled={writesEnabled} />}
        {screen === "reprint"   && <Reprint />}
        {screen === "items"     && <Items />}
        {screen === "sales"     && <Sales />}
        {screen === "suppliers" && <Suppliers />}
        {screen === "settings"  && <Settings />}
      </main>
    </div>
  );
}
