"use client";

import { useCallback, useEffect, useState } from "react";

const apiBase = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

type ClockRow = {
  id: string;
  timeIn: string;
  timeOut: string | null;
  user: { name: string | null; email: string; role: string };
};

function duration(timeIn: string, timeOut: string | null) {
  if (!timeOut) return "Active";
  const ms = new Date(timeOut).getTime() - new Date(timeIn).getTime();
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  return `${h}h ${m}m`;
}

export default function ClockingPage() {
  const [clockings, setClockings] = useState<ClockRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [acting, setActing] = useState(false);
  const [clockMsg, setClockMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    const token = localStorage.getItem("mwalimu_token");
    if (!token) return;
    setLoading(true);
    try {
      const res = await fetch(`${apiBase}/clockings`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      if (res.ok) setClockings((await res.json()).data ?? []);
      else setError("Failed to load clockings");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function clockInOut(action: "in" | "out") {
    const token = localStorage.getItem("mwalimu_token");
    if (!token) return;
    setActing(true);
    setClockMsg(null);
    try {
      const res = await fetch(`${apiBase}/clockings/${action}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error ?? "Failed");
      setClockMsg(action === "in" ? "Clocked in successfully." : "Clocked out successfully.");
      await load();
    } catch (err: any) {
      setClockMsg(err?.message ?? "Failed");
    } finally {
      setActing(false);
    }
  }

  const today = new Date().toISOString().slice(0, 10);
  const todayClockings = clockings.filter((c) => c.timeIn.slice(0, 10) === today);
  const activeCount = clockings.filter((c) => !c.timeOut && c.timeIn.slice(0, 10) === today).length;

  return (
    <div>
      <h1 style={{ margin: "0 0 1rem", fontSize: "1.35rem", fontWeight: 800, letterSpacing: "-0.02em" }}>Staff Clocking</h1>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: "1rem", marginBottom: "1.5rem" }}>
        <div className="card">
          <div className="stat-label">Currently clocked in today</div>
          <div className="stat-value" style={{ color: activeCount > 0 ? "#16a34a" : undefined }}>{activeCount}</div>
        </div>
        <div className="card">
          <h3 style={{ margin: "0 0 0.75rem" }}>Your attendance</h3>
          <div style={{ display: "flex", gap: "0.5rem" }}>
            <button className="button" onClick={() => clockInOut("in")} disabled={acting} style={{ flex: 1 }}>
              Clock In
            </button>
            <button className="button ghost" onClick={() => clockInOut("out")} disabled={acting} style={{ flex: 1 }}>
              Clock Out
            </button>
          </div>
          {clockMsg && (
            <div className="signin-success" style={{ marginTop: "0.5rem" }}>{clockMsg}</div>
          )}
        </div>
      </div>

      {error && <div className="signin-error" style={{ marginBottom: "1rem" }}>{error}</div>}

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.75rem" }}>
        <h3 style={{ margin: 0 }}>Today's attendance</h3>
        <button className="button ghost" style={{ fontSize: "0.82rem" }} onClick={load}>↻</button>
      </div>

      {loading ? (
        <div style={{ color: "var(--muted)" }}>Loading…</div>
      ) : (
        <div className="table-wrap" style={{ marginBottom: "1.5rem" }}>
          <table className="data-table">
            <thead><tr><th>Staff</th><th>Role</th><th>Clock In</th><th>Clock Out</th><th>Duration</th></tr></thead>
            <tbody>
              {todayClockings.length === 0 && <tr><td colSpan={5} style={{ textAlign: "center", color: "var(--muted)" }}>No clockings today.</td></tr>}
              {todayClockings.map((c) => (
                <tr key={c.id}>
                  <td style={{ fontWeight: 700 }}>{c.user.name ?? c.user.email}</td>
                  <td><span className="chip chip-gray">{c.user.role}</span></td>
                  <td style={{ fontSize: "0.88rem" }}>{new Date(c.timeIn).toLocaleTimeString("en-KE", { hour: "2-digit", minute: "2-digit" })}</td>
                  <td style={{ fontSize: "0.88rem" }}>
                    {c.timeOut ? new Date(c.timeOut).toLocaleTimeString("en-KE", { hour: "2-digit", minute: "2-digit" }) : <span className="chip chip-green">Active</span>}
                  </td>
                  <td style={{ fontWeight: 700 }}>{duration(c.timeIn, c.timeOut)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h3 style={{ margin: "0 0 0.75rem" }}>Recent history</h3>
      <div className="table-wrap">
        <table className="data-table">
          <thead><tr><th>Date</th><th>Staff</th><th>Clock In</th><th>Clock Out</th><th>Duration</th></tr></thead>
          <tbody>
            {clockings.filter((c) => c.timeIn.slice(0, 10) !== today).slice(0, 30).map((c) => (
              <tr key={c.id}>
                <td style={{ fontSize: "0.82rem", color: "var(--muted)" }}>{new Date(c.timeIn).toLocaleDateString("en-KE", { day: "numeric", month: "short" })}</td>
                <td style={{ fontWeight: 700 }}>{c.user.name ?? c.user.email}</td>
                <td style={{ fontSize: "0.88rem" }}>{new Date(c.timeIn).toLocaleTimeString("en-KE", { hour: "2-digit", minute: "2-digit" })}</td>
                <td style={{ fontSize: "0.88rem" }}>{c.timeOut ? new Date(c.timeOut).toLocaleTimeString("en-KE", { hour: "2-digit", minute: "2-digit" }) : "—"}</td>
                <td>{duration(c.timeIn, c.timeOut)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
