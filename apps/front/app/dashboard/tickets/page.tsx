"use client";

import { useCallback, useEffect, useState } from "react";

const apiBase = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

// Three columns because there are three teams. Express, standard and large
// orders are picked by different people working in parallel, so showing them
// as one list would suggest a queue that does not exist — an express customer
// is not waiting behind a large order.
const BANDS = [
  { key: "E", label: "Express",  hint: "small baskets, quick" },
  { key: "B", label: "Standard", hint: "" },
  { key: "C", label: "Large",    hint: "big orders" },
];

function kenyanDate() {
  return new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function fmt(n: number) {
  return "KES " + Number(n ?? 0).toLocaleString("en-KE", { maximumFractionDigits: 0 });
}

function timeOnly(iso: string) {
  if (!iso) return "";
  return new Date(iso).toLocaleTimeString("en-KE", { hour: "2-digit", minute: "2-digit", hour12: false });
}

// How long this customer has been standing there.
//
// Clamped at zero on purpose. issuedAt is stamped from the shop's DATABASE
// clock, which on this network runs some minutes ahead of everything else, so a
// ticket issued moments ago can arrive here dated slightly in the future. A
// board reading "-3 min waiting" would look broken; zero is honest enough for
// something whose whole job is "roughly how long".
function waitingMinutes(issuedAt: string) {
  if (!issuedAt) return 0;
  const mins = Math.floor((Date.now() - new Date(issuedAt).getTime()) / 60000);
  return mins > 0 ? mins : 0;
}

type Ticket = {
  ticketDay: string;
  ticketCode: string;
  band: string;
  seq: number;
  receiptno: string;
  arname: string | null;
  amount: number;
  lineCount: number;
  etaLo: number;
  etaHi: number;
  state: string;
  issuedAt: string;
  till: string | null;
  staff: string | null;
  readyAt: string | null;
  collectedAt: string | null;
};

export default function TicketsPage() {
  const [token, setToken]     = useState("");
  const [day, setDay]         = useState(kenyanDate);
  const [rows, setRows]       = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy]       = useState<string | null>(null);
  const [error, setError]     = useState<string | null>(null);
  const [showDone, setShowDone] = useState(false);
  // Only used to re-render the waiting clocks; the value itself is never read.
  const [, setTick]           = useState(0);

  useEffect(() => { setToken(localStorage.getItem("mwalimu_token") ?? ""); }, []);

  const load = useCallback(() => {
    if (!token || !day) return;
    setLoading(true);
    fetch(`${apiBase}/tickets/board?day=${day}`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.ok ? r.json() : Promise.reject(new Error(String(r.status))))
      .then(d => { setRows(d.data ?? []); setError(null); })
      .catch(() => setError("Could not load the board."))
      .finally(() => setLoading(false));
  }, [token, day]);

  useEffect(() => { load(); }, [load]);

  // The shop pusher sends tickets every 30 seconds, so polling faster than that
  // only adds requests without adding news.
  useEffect(() => {
    const t = setInterval(load, 30000);
    return () => clearInterval(t);
  }, [load]);

  // The waiting figures are relative to now, so they have to be redrawn even
  // when nothing has been fetched.
  useEffect(() => {
    const t = setInterval(() => setTick(n => n + 1), 30000);
    return () => clearInterval(t);
  }, []);

  async function collect(t: Ticket) {
    if (busy) return;
    setBusy(t.ticketCode);
    try {
      const r = await fetch(`${apiBase}/tickets/collect`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ ticketDay: t.ticketDay, ticketCode: t.ticketCode })
      });
      if (!r.ok) throw new Error(String(r.status));

      // Moved locally so the press is felt immediately. The shop remains the
      // authority: the next poll overwrites this with whatever MySQL says, so
      // if the write-back fails the ticket comes back rather than silently
      // staying closed.
      setRows(rs => rs.map(x =>
        x.ticketCode === t.ticketCode ? { ...x, state: "COLLECTED", collectedAt: new Date().toISOString() } : x));
      setError(null);
    } catch {
      setError(`Could not close ${t.ticketCode}. It is still open.`);
    } finally {
      setBusy(null);
    }
  }

  const open = rows.filter(r => r.state !== "COLLECTED");
  const done = rows.filter(r => r.state === "COLLECTED");

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "0.75rem" }}>
        <div>
          <h2 style={{ margin: 0, fontWeight: 800, letterSpacing: "-0.02em" }}>Collection Tickets</h2>
          <p className="muted" style={{ margin: 0 }}>
            {open.length} waiting · {done.length} collected
            {loading && " · refreshing…"}
          </p>
        </div>
        <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
          <button type="button" onClick={load} className="filter-input"
            style={{ cursor: "pointer", background: "none" }}>Refresh</button>
          <input type="date" value={day} onChange={e => setDay(e.target.value)}
            className="filter-input" style={{ fontSize: "0.95rem" }} />
        </div>
      </div>

      {error && (
        <div style={{ padding: "0.75rem 1rem", borderRadius: 8, background: "#fee2e2", color: "#991b1b", fontSize: "0.9rem" }}>
          {error}
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: "1rem" }}>
        {BANDS.map(band => {
          const mine = open.filter(t => t.band === band.key);
          return (
            <section key={band.key} style={{ display: "flex", flexDirection: "column", gap: "0.6rem" }}>
              <header style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline",
                borderBottom: "2px solid #111827", paddingBottom: "0.35rem" }}>
                <strong style={{ fontSize: "1rem" }}>{band.label}</strong>
                <span className="muted" style={{ fontSize: "0.85rem" }}>{mine.length} waiting</span>
              </header>

              {mine.length === 0 && (
                <p className="muted" style={{ fontSize: "0.85rem", margin: 0 }}>
                  {loading ? "…" : "Nothing waiting."}
                </p>
              )}

              {mine.map(t => {
                const waited = waitingMinutes(t.issuedAt);
                // "Late" means past the upper end of what the slip promised the
                // customer, which is the number they are actually holding.
                const late = t.etaHi > 0 && waited > t.etaHi;
                return (
                  <article key={t.ticketCode}
                    style={{
                      border: `1px solid ${late ? "#dc2626" : "#e5e7eb"}`,
                      borderLeft: `4px solid ${late ? "#dc2626" : t.state === "READY" ? "#10b981" : "#9ca3af"}`,
                      borderRadius: 8, padding: "0.7rem 0.8rem", background: "#fff",
                      display: "flex", flexDirection: "column", gap: "0.35rem"
                    }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                      <strong style={{ fontSize: "1.25rem", letterSpacing: "-0.01em" }}>{t.ticketCode}</strong>
                      <span style={{ fontSize: "0.75rem", fontWeight: 700, textTransform: "uppercase",
                        color: t.state === "READY" ? "#047857" : "#6b7280" }}>
                        {t.state === "READY" ? "Ready" : "Picking"}
                      </span>
                    </div>

                    {t.arname && <div style={{ fontSize: "0.9rem" }}>{t.arname}</div>}

                    <div className="muted" style={{ fontSize: "0.82rem" }}>
                      {t.lineCount} {t.lineCount === 1 ? "item" : "items"} · {fmt(t.amount)}
                    </div>

                    <div style={{ fontSize: "0.82rem", color: late ? "#b91c1c" : "#6b7280" }}>
                      issued {timeOnly(t.issuedAt)} · waiting {waited} min
                      {t.etaHi > 0 && ` (told ${t.etaLo}–${t.etaHi})`}
                    </div>

                    <button type="button" onClick={() => collect(t)} disabled={busy === t.ticketCode}
                      style={{
                        marginTop: "0.2rem", padding: "0.45rem 0.6rem", borderRadius: 6,
                        border: "1px solid #111827", background: "#111827", color: "#fff",
                        fontWeight: 600, fontSize: "0.85rem", cursor: busy ? "wait" : "pointer",
                        fontFamily: "inherit"
                      }}>
                      {busy === t.ticketCode ? "Closing…" : "Handed over"}
                    </button>
                  </article>
                );
              })}
            </section>
          );
        })}
      </div>

      {done.length > 0 && (
        <section>
          <button type="button" onClick={() => setShowDone(s => !s)}
            style={{ background: "none", border: "none", padding: 0, cursor: "pointer",
              fontFamily: "inherit", fontSize: "0.9rem", fontWeight: 600 }}>
            {showDone ? "▾" : "▸"} {done.length} collected today
          </button>
          {showDone && (
            <div style={{ marginTop: "0.6rem", display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: "0.4rem" }}>
              {done.map(t => (
                <div key={t.ticketCode} className="muted"
                  style={{ fontSize: "0.82rem", padding: "0.4rem 0.6rem", border: "1px solid #e5e7eb", borderRadius: 6 }}>
                  <strong>{t.ticketCode}</strong> · {t.arname || "walk-in"} · {fmt(t.amount)}
                  <br />collected {timeOnly(t.collectedAt ?? "")}
                </div>
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
