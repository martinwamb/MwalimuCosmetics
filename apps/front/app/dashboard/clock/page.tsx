"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const apiBase = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

// The tablet sits on a counter and stays signed in as the tickets account all
// day. Staff never sign in to it; they tap their own name. So this page is a
// board of names, big enough to hit without looking, and everything else is
// out of the way.

type Person = { id: string; name: string; state: "IN" | "OUT"; since: string | null };
type Shift = {
  id: string; name: string; timeIn: string; timeOut: string | null;
  deviceRef: string | null; minutes: number | null;
  hasPhotoIn: boolean; hasPhotoOut: boolean;
};

function kenyanDate() {
  return new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function timeOnly(iso: string | null) {
  if (!iso) return "";
  return new Date(iso).toLocaleTimeString("en-KE", { hour: "2-digit", minute: "2-digit", hour12: false });
}

function hoursFrom(minutes: number | null) {
  if (minutes === null) return "still in";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export default function ClockPage() {
  const [token, setToken]   = useState("");
  const [role, setRole]     = useState<string | null>(null);
  const [people, setPeople] = useState<Person[]>([]);
  const [error, setError]   = useState<string | null>(null);
  const [note, setNote]     = useState<string | null>(null);
  const [busy, setBusy]     = useState<string | null>(null);
  const [chosen, setChosen] = useState<Person | null>(null);

  // ADMIN only, below the board.
  const [day, setDay]       = useState(kenyanDate);
  const [shifts, setShifts] = useState<Shift[]>([]);

  // Whether the camera actually came up. A ref alone would not re-render, so
  // the "no camera" line would be a frame behind the thing it describes.
  const [camera, setCamera] = useState(false);
  const [photo, setPhoto]   = useState<string | null>(null);

  const videoRef  = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    setToken(localStorage.getItem("mwalimu_token") ?? "");
    setRole(localStorage.getItem("mwalimu_role"));
  }, []);

  const loadRoster = useCallback(() => {
    if (!token) return;
    fetch(`${apiBase}/clockings/roster`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.ok ? r.json() : Promise.reject(new Error(String(r.status))))
      .then(d => { setPeople(d.data ?? []); setError(null); })
      .catch(() => setError("Could not load the staff list."));
  }, [token]);

  useEffect(() => { loadRoster(); }, [loadRoster]);

  // Somebody else may clock in at the office, and this board is left on a
  // counter all day looking at nobody.
  useEffect(() => {
    const t = setInterval(loadRoster, 60000);
    return () => clearInterval(t);
  }, [loadRoster]);

  const loadShifts = useCallback(() => {
    if (!token || role !== "ADMIN") return;
    fetch(`${apiBase}/clockings?day=${day}`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.ok ? r.json() : Promise.reject(new Error(String(r.status))))
      .then(d => setShifts(d.data ?? []))
      .catch(() => setShifts([]));
  }, [token, role, day]);

  useEffect(() => { loadShifts(); }, [loadShifts]);

  // ── The camera ────────────────────────────────────────────────
  //
  // Opened only once a name has been tapped, and closed the moment the press is
  // over. A tablet with its camera light on all day, pointed at the shop floor,
  // is a different thing from one that takes a picture when somebody asks it to.
  function stopCamera() {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
    setCamera(false);
  }

  useEffect(() => stopCamera, []);

  async function choose(p: Person) {
    setChosen(p);
    setNote(null);
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" } });
      streamRef.current = stream;
      setCamera(true);
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => {});
      }
    } catch {
      // A refused or missing camera must not stop somebody starting work. The
      // shift is still recorded; it simply has no photo against it.
      streamRef.current = null;
      setCamera(false);
    }
  }

  function cancel() {
    stopCamera();
    setChosen(null);
  }

  function capture(): string | undefined {
    const video = videoRef.current;
    if (!video || !streamRef.current || !video.videoWidth) return undefined;
    // Downscaled: this is a face at arm's length, not evidence to enlarge, and
    // a full-resolution tablet frame is megabytes for no gain.
    const w = 480;
    const h = Math.round((video.videoHeight / video.videoWidth) * w);
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return undefined;
    ctx.drawImage(video, 0, 0, w, h);
    return canvas.toDataURL("image/jpeg", 0.6);
  }

  async function confirm() {
    if (!chosen || busy) return;
    const p = chosen;
    setBusy(p.id);
    const selfieData = capture();
    try {
      const r = await fetch(`${apiBase}/clockings`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ userId: p.id, selfieData })
      });
      if (!r.ok) throw new Error(String(r.status));
      const d = await r.json();
      setNote(d.status === "CLOCKED_IN"
        ? `${p.name} clocked in at ${timeOnly(new Date().toISOString())}.`
        : `${p.name} clocked out at ${timeOnly(new Date().toISOString())}.`);
      setError(null);
      stopCamera();
      setChosen(null);
      loadRoster();
      loadShifts();
    } catch {
      setError(`Could not record ${p.name}. Nothing was saved — try again.`);
    } finally {
      setBusy(null);
    }
  }

  // The photo route is guarded by a bearer token, which an <img src> or a link
  // cannot carry. Fetching it and handing the browser a blob keeps the guard a
  // header rather than putting a working token in a URL, where it would sit in
  // browser history and in every access log between here and the server.
  async function showPhoto(id: string, which: "in" | "out") {
    try {
      const r = await fetch(`${apiBase}/clockings/${id}/photo/${which}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!r.ok) throw new Error(String(r.status));
      const blob = await r.blob();
      setPhoto(prev => {
        if (prev) URL.revokeObjectURL(prev);
        return URL.createObjectURL(blob);
      });
    } catch {
      setError("Could not open that photo.");
    }
  }

  function closePhoto() {
    setPhoto(prev => { if (prev) URL.revokeObjectURL(prev); return null; });
  }

  const inNow = people.filter(p => p.state === "IN").length;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
      <div>
        <h2 style={{ margin: 0, fontWeight: 800, letterSpacing: "-0.02em" }}>Clock In</h2>
        <p className="muted" style={{ margin: 0 }}>
          {inNow} of {people.length} in{note ? ` · ${note}` : ""}
        </p>
      </div>

      {error && (
        <div style={{ padding: "0.75rem 1rem", borderRadius: 8, background: "#fee2e2", color: "#991b1b", fontSize: "0.9rem" }}>
          {error}
        </div>
      )}

      {photo && (
        <div onClick={closePhoto}
          style={{
            position: "fixed", inset: 0, zIndex: 50, background: "rgba(17,24,39,0.75)",
            display: "flex", alignItems: "center", justifyContent: "center", padding: "1rem"
          }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={photo} alt="Clocking photo"
            style={{ maxWidth: "100%", maxHeight: "100%", borderRadius: 10 }} />
        </div>
      )}

      {/* The camera step. One name, one picture, one press. */}
      {chosen && (
        <section style={{
          border: "1px solid #e5e7eb", borderRadius: 10, padding: "1rem",
          background: "#fff", display: "flex", flexDirection: "column",
          gap: "0.75rem", alignItems: "center"
        }}>
          <strong style={{ fontSize: "1.25rem" }}>{chosen.name}</strong>
          <video ref={videoRef} playsInline muted
            style={{
              width: "100%", maxWidth: 360, borderRadius: 10, background: "#111827",
              aspectRatio: "4 / 3", objectFit: "cover", transform: "scaleX(-1)"
            }} />
          {!camera && (
            <p className="muted" style={{ margin: 0, fontSize: "0.85rem", textAlign: "center" }}>
              No camera. The clocking will still be recorded, without a photo.
            </p>
          )}
          <div style={{ display: "flex", gap: "0.5rem", width: "100%", maxWidth: 360 }}>
            <button type="button" onClick={cancel} disabled={busy === chosen.id}
              style={{
                flex: 1, padding: "0.9rem", borderRadius: 8, border: "1px solid #d1d5db",
                background: "#fff", fontWeight: 600, fontSize: "1rem",
                fontFamily: "inherit", cursor: "pointer"
              }}>
              Cancel
            </button>
            <button type="button" onClick={confirm} disabled={busy === chosen.id}
              style={{
                flex: 2, padding: "0.9rem", borderRadius: 8,
                border: `1px solid ${chosen.state === "IN" ? "#111827" : "#047857"}`,
                background: chosen.state === "IN" ? "#111827" : "#047857",
                color: "#fff", fontWeight: 700, fontSize: "1rem",
                fontFamily: "inherit", cursor: busy ? "wait" : "pointer"
              }}>
              {busy === chosen.id ? "…" : chosen.state === "IN" ? "Clock out" : "Clock in"}
            </button>
          </div>
        </section>
      )}

      {/* The board of names. Big targets: this is used with a finger, often in a
          hurry, by somebody who has just walked in off the street. */}
      {!chosen && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: "0.6rem" }}>
          {people.length === 0 && <p className="muted" style={{ margin: 0 }}>No staff to show.</p>}
          {people.map(p => (
            <button key={p.id} type="button" onClick={() => choose(p)}
              style={{
                textAlign: "left", padding: "1rem", borderRadius: 10,
                border: `1px solid ${p.state === "IN" ? "#10b981" : "#e5e7eb"}`,
                borderLeft: `4px solid ${p.state === "IN" ? "#10b981" : "#9ca3af"}`,
                background: "#fff", cursor: "pointer", fontFamily: "inherit",
                display: "flex", flexDirection: "column", gap: "0.3rem"
              }}>
              <strong style={{ fontSize: "1.05rem" }}>{p.name}</strong>
              <span style={{ fontSize: "0.85rem", color: p.state === "IN" ? "#047857" : "#6b7280" }}>
                {p.state === "IN" ? `In since ${timeOnly(p.since)}` : "Out"}
              </span>
            </button>
          ))}
        </div>
      )}

      {/* Only an admin sees the day back. Everybody else sees a board of names
          and nothing about anybody's hours. */}
      {role === "ADMIN" && (
        <section style={{ display: "flex", flexDirection: "column", gap: "0.6rem" }}>
          <header style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline",
            borderBottom: "2px solid #111827", paddingBottom: "0.35rem", flexWrap: "wrap", gap: "0.5rem" }}>
            <strong style={{ fontSize: "1rem" }}>Shifts</strong>
            <input type="date" value={day} onChange={e => setDay(e.target.value)}
              className="filter-input" style={{ fontSize: "0.95rem" }} />
          </header>

          {shifts.length === 0 && <p className="muted" style={{ margin: 0, fontSize: "0.85rem" }}>Nothing recorded.</p>}

          {shifts.length > 0 && (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Name</th><th>In</th><th>Out</th><th>Worked</th><th>Photos</th>
                  </tr>
                </thead>
                <tbody>
                  {shifts.map(s => (
                    <tr key={s.id}>
                      <td>{s.name}</td>
                      <td>{timeOnly(s.timeIn)}</td>
                      <td>{s.timeOut ? timeOnly(s.timeOut) : "—"}</td>
                      <td>{hoursFrom(s.minutes)}</td>
                      <td style={{ display: "flex", gap: "0.4rem" }}>
                        {(["in", "out"] as const).map(which =>
                          (which === "in" ? s.hasPhotoIn : s.hasPhotoOut) ? (
                            <button key={which} type="button" onClick={() => showPhoto(s.id, which)}
                              style={{
                                background: "none", border: "none", padding: 0, cursor: "pointer",
                                fontFamily: "inherit", fontSize: "0.82rem", textDecoration: "underline"
                              }}>
                              {which}
                            </button>
                          ) : null
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
