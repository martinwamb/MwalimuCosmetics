"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const apiBase = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

// The tablet sits on a counter and stays signed in as the tickets account all
// day. Staff never sign in to it; they tap their own name and type their PIN.
// So this page is a list of names, big enough to hit without looking, and
// everything else is out of the way.

type Person = { id: string; name: string; state: "IN" | "OUT"; since: string | null; hasPin: boolean };
type Shift = {
  id: string; name: string; timeIn: string; timeOut: string | null;
  deviceRef: string | null; minutes: number | null;
  hasPhotoIn: boolean; hasPhotoOut: boolean;
};

// Word for word what the server says for NO_PIN, so the tablet reads the same
// whichever side noticed first.
const NO_PIN_TEXT = "No PIN yet - ask the admin to issue one.";
const ROSTER_ERROR = "Could not load the staff list.";

const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "clear", "0", "back"] as const;

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
  const [busy, setBusy]     = useState(false);
  const [chosen, setChosen] = useState<Person | null>(null);

  // The PIN pad. The digits live in a ref as well as state so two quick taps
  // cannot both read the same half-typed PIN before a render catches up.
  const [pin, setPin]         = useState("");
  const [pinMsg, setPinMsg]   = useState<string | null>(null);
  const [locked, setLocked]   = useState(false);
  const typed    = useRef("");
  const sending  = useRef(false);
  const lockTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dotsRef  = useRef<HTMLDivElement | null>(null);

  // ADMIN only, below the board.
  const [day, setDay]       = useState(kenyanDate);
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [photo, setPhoto]   = useState<string | null>(null);

  // Adding somebody new, from the tablet.
  const [adding, setAdding]   = useState(false);
  const [newName, setNewName] = useState("");
  const [saving, setSaving]   = useState(false);
  const [fresh, setFresh]     = useState<{ name: string; pin: string } | null>(null);

  const videoRef  = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const opening   = useRef(false);
  const session   = useRef(0);
  const picking   = useRef(0);

  useEffect(() => {
    setToken(localStorage.getItem("mwalimu_token") ?? "");
    setRole(localStorage.getItem("mwalimu_role"));
  }, []);

  const loadRoster = useCallback((): Promise<Person[] | null> => {
    if (!token) return Promise.resolve(null);
    return fetch(`${apiBase}/clockings/roster`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.ok ? r.json() : Promise.reject(new Error(String(r.status))))
      .then(d => {
        const list: Person[] = d.data ?? [];
        setPeople(list);
        // Only its own complaint. A failed clocking reloads the roster too, and
        // wiping that message would leave somebody believing they were in.
        setError(e => e === ROSTER_ERROR ? null : e);
        return list;
      })
      .catch(() => { setError(ROSTER_ERROR); return null; });
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
  // There is no preview: one frame goes with the PIN, and the server keeps it
  // only when the PIN is right.
  function stopCamera() {
    // Bumping the session orphans a getUserMedia still waiting on the browser,
    // so a camera that comes up after the press is over is shut at once.
    session.current++;
    opening.current = false;
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
    if (videoRef.current) videoRef.current.srcObject = null;
  }

  async function openCamera() {
    const mine = ++session.current;
    opening.current = true;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" }, audio: false });
      if (mine !== session.current) {
        stream.getTracks().forEach(t => t.stop());
        return;
      }
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => {});
      }
    } catch {
      // A refused or missing camera must not stop somebody starting work. The
      // shift is still recorded; it simply has no photo against it.
      if (mine === session.current) streamRef.current = null;
    } finally {
      if (mine === session.current) opening.current = false;
    }
  }

  useEffect(() => () => {
    // choose() may still be waiting on the roster; this makes it give up
    // rather than open a camera after the page has gone.
    picking.current++;
    stopCamera();
    if (lockTimer.current) clearTimeout(lockTimer.current);
  }, []);

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

  // Somebody who knows their PIN can type it before the camera has a first
  // frame. Wait for one briefly; past a second the clocking goes without.
  async function grabFrame(): Promise<string | undefined> {
    const deadline = Date.now() + 1000;
    while (Date.now() < deadline &&
      (opening.current || (streamRef.current && !videoRef.current?.videoWidth))) {
      await new Promise(r => setTimeout(r, 50));
    }
    return capture();
  }

  // ── The PIN pad ───────────────────────────────────────────────

  function setTyped(v: string) {
    typed.current = v;
    setPin(v);
  }

  function closePad() {
    stopCamera();
    if (lockTimer.current) { clearTimeout(lockTimer.current); lockTimer.current = null; }
    setTyped("");
    setPinMsg(null);
    setLocked(false);
    setChosen(null);
  }

  async function choose(tapped: Person) {
    setNote(null);
    setError(null);
    const mine = ++picking.current;
    let p = tapped;
    if (!p.hasPin) {
      // The board can be a minute old, and a PIN handed over on a slip is
      // usually tried straight away. Ask the server before turning anybody off.
      const list = await loadRoster();
      if (mine !== picking.current) return;
      const now = list?.find(x => x.id === p.id);
      if (!now?.hasPin) {
        if (list) setError(now ? NO_PIN_TEXT : "No such staff member.");
        return;
      }
      p = now;
    }
    setTyped("");
    setPinMsg(null);
    setLocked(false);
    setChosen(p);
    void openCamera();
  }

  function shake() {
    dotsRef.current?.animate(
      [0, -12, 12, -8, 8, 0].map(x => ({ transform: `translateX(${x}px)` })),
      { duration: 380, easing: "ease-in-out" }
    );
  }

  // The name stays locked on the server; the tablet only has to stop offering
  // the pad, then get out of the way for the next person.
  function lockOut(message: string) {
    stopCamera();
    setLocked(true);
    setPinMsg(message);
    lockTimer.current = setTimeout(() => { closePad(); setError(message); }, 4000);
  }

  function press(key: (typeof KEYS)[number]) {
    if (!chosen || sending.current || locked) return;
    const cur = typed.current;
    if (key === "clear") { setTyped(""); return; }
    if (key === "back") { setTyped(cur.slice(0, -1)); return; }
    if (cur.length >= 4) return;
    const next = cur + key;
    setTyped(next);
    if (next.length === 4) void submit(chosen, next);
  }

  async function submit(p: Person, entered: string) {
    if (sending.current) return;
    sending.current = true;
    setBusy(true);
    // The pad cannot be cancelled while it waits, so a request lost on the
    // tablet's Wi-Fi would hold the camera on and the board shut for as long as
    // the browser cares to wait. Fifteen seconds is plenty for a real answer.
    const ac = new AbortController();
    const giveUp = setTimeout(() => ac.abort(), 15000);
    try {
      const selfieData = await grabFrame();
      const r = await fetch(`${apiBase}/clockings`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ userId: p.id, pin: entered, selfieData }),
        signal: ac.signal
      });
      const d = await r.json().catch(() => ({}));

      if (r.ok) {
        setNote(d.status === "CLOCKED_IN"
          ? `${p.name} clocked in at ${timeOnly(new Date().toISOString())}.`
          : `${p.name} clocked out at ${timeOnly(new Date().toISOString())}.`);
        setError(null);
        closePad();
        loadRoster();
        loadShifts();
        return;
      }

      // A wrong PIN keeps the camera running for the retry. Stopping it here
      // would let anybody switch the photo off by getting the PIN wrong once.
      if (d.code === "WRONG_PIN") {
        const left = typeof d.remaining === "number" ? d.remaining : null;
        if (left === 0) {
          lockOut("Wrong PIN. That was the last try: this name is locked for 15 minutes.");
        } else {
          setPinMsg(left === null ? "Wrong PIN." : `Wrong PIN. ${left} ${left === 1 ? "try" : "tries"} left.`);
          shake();
        }
        return;
      }
      if (d.code === "LOCKED") {
        lockOut(typeof d.error === "string" ? d.error
          : `Too many wrong PINs. Try again after ${timeOnly(typeof d.until === "string" ? d.until : null)}.`);
        return;
      }

      // Any other refusal says why, and "try again" would be a lie: signed in
      // as somebody who may only clock themselves, no retry can ever work.
      closePad();
      setError(d.code === "NO_PIN"
        ? (typeof d.error === "string" ? d.error : NO_PIN_TEXT)
        : r.status >= 400 && r.status < 500 && typeof d.error === "string"
          ? d.error.replace(/\.?$/, ".")
          : `Could not record ${p.name}. Nothing was saved — try again.`);
      loadRoster();
    } catch {
      closePad();
      if (ac.signal.aborted) {
        // The server may have saved it and only the answer got lost, and a
        // second try would then clock the person straight back out.
        setError(`No answer from the server for ${p.name}. Check the board before trying again.`);
        loadRoster();
      } else {
        setError(`Could not record ${p.name}. Nothing was saved — try again.`);
      }
    } finally {
      clearTimeout(giveUp);
      sending.current = false;
      setBusy(false);
      setTyped("");
    }
  }

  // A finger on the tablet, or a keyboard if one is plugged in.
  useEffect(() => {
    if (!chosen) return;
    function onKey(e: KeyboardEvent) {
      if (/^[0-9]$/.test(e.key)) { e.preventDefault(); press(e.key as (typeof KEYS)[number]); }
      else if (e.key === "Backspace") { e.preventDefault(); press("back"); }
      else if (e.key === "Escape" && !sending.current) { e.preventDefault(); closePad(); }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // A name tapped and walked away from would leave the camera on and a
  // half-typed PIN on the counter. Half a minute of nothing closes the pad.
  useEffect(() => {
    if (!chosen || busy || locked) return;
    const t = setTimeout(closePad, 30000);
    return () => clearTimeout(t);
  }, [chosen, pin, busy, locked]);

  // Nor may a new person's PIN sit on the counter in big digits for the rest
  // of the day, with the board hidden behind it. A minute is enough to say it.
  useEffect(() => {
    if (!fresh) return;
    const t = setTimeout(() => setFresh(null), 60000);
    return () => clearTimeout(t);
  }, [fresh]);

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

  async function addPerson() {
    const name = newName.trim();
    if (name.length < 2 || saving) return;
    setSaving(true);
    try {
      const r = await fetch(`${apiBase}/clockings/staff`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ name })
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(typeof d.error === "string" ? d.error : String(r.status));
      setNewName("");
      setAdding(false);
      setError(null);
      if (typeof d.pin === "string") {
        setFresh({ name: typeof d.data?.name === "string" ? d.data.name : name, pin: d.pin });
      } else {
        setNote(`${name} added. An admin issues their PIN on the Staff page.`);
      }
      loadRoster();
    } catch (e: any) {
      setError(e?.message ?? "Could not add that person.");
    } finally {
      setSaving(false);
    }
  }

  function closePhoto() {
    setPhoto(prev => { if (prev) URL.revokeObjectURL(prev); return null; });
  }

  const inNow = people.filter(p => p.state === "IN").length;
  const clockingOut = chosen?.state === "IN";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
      {/* The camera for the silent photo. It stays in the layout, only
          invisible: display:none stops some browsers producing frames, and then
          there is nothing to capture. */}
      <video ref={videoRef} playsInline muted aria-hidden="true"
        style={{
          position: "fixed", left: 0, bottom: 0, width: 1, height: 1,
          opacity: 0, pointerEvents: "none"
        }} />

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "0.75rem" }}>
        <div>
          <h2 style={{ margin: 0, fontWeight: 800, letterSpacing: "-0.02em" }}>Clock In</h2>
          <p className="muted" style={{ margin: 0 }}>
            {inNow} of {people.length} in{note ? ` · ${note}` : ""}
          </p>
        </div>
        {!chosen && !adding && !fresh && (
          <button type="button" onClick={() => { setAdding(true); setNote(null); setError(null); }}
            className="filter-input" style={{ cursor: "pointer", background: "none" }}>
            Add someone
          </button>
        )}
      </div>

      {/* A name is all the tablet may give. The account it makes cannot be
          signed into and carries the least-privileged role there is; an admin
          sets the role, the real email and a password on the Staff page. */}
      {adding && (
        <section style={{
          border: "1px solid #e5e7eb", borderRadius: 10, padding: "1rem", background: "#fff",
          display: "flex", flexDirection: "column", gap: "0.6rem", maxWidth: 420
        }}>
          <strong style={{ fontSize: "1rem" }}>Add someone to the board</strong>
          <input value={newName} onChange={e => setNewName(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") addPerson(); }}
            placeholder="Full name" autoFocus
            className="filter-input" style={{ fontSize: "1rem" }} />
          <p className="muted" style={{ margin: 0, fontSize: "0.8rem" }}>
            They get a PIN straight away, shown once. An admin sets their role and login later.
          </p>
          <div style={{ display: "flex", gap: "0.5rem" }}>
            <button type="button" onClick={() => { setAdding(false); setNewName(""); }}
              style={{
                flex: 1, padding: "0.7rem", borderRadius: 8, border: "1px solid #d1d5db",
                background: "#fff", fontWeight: 600, fontFamily: "inherit", cursor: "pointer"
              }}>
              Cancel
            </button>
            <button type="button" onClick={addPerson} disabled={saving || newName.trim().length < 2}
              style={{
                flex: 2, padding: "0.7rem", borderRadius: 8, border: "1px solid #047857",
                background: newName.trim().length < 2 ? "#9ca3af" : "#047857", color: "#fff",
                fontWeight: 700, fontFamily: "inherit", cursor: saving ? "wait" : "pointer"
              }}>
              {saving ? "…" : "Add"}
            </button>
          </div>
        </section>
      )}

      {/* The new person's PIN, once. The server keeps only a keyed hash of it,
          so after Done nobody can show it again; a forgotten one is reset on the
          Staff page. The board stays hidden until Done, or for a minute at most. */}
      {fresh && (
        <section style={{
          border: "2px solid #047857", borderRadius: 10, padding: "1.25rem", background: "#ecfdf5",
          display: "flex", flexDirection: "column", gap: "0.75rem", maxWidth: 460
        }}>
          <p style={{ margin: 0, fontSize: "1.05rem", lineHeight: 1.5 }}>
            <strong>{fresh.name}</strong> is on the board. Their PIN is
          </p>
          <div style={{
            fontSize: "3rem", fontWeight: 800, letterSpacing: "0.3em",
            fontVariantNumeric: "tabular-nums", color: "#064e3b"
          }}>
            {fresh.pin}
          </div>
          <p style={{ margin: 0, fontSize: "1rem" }}>
            Tell them now. It disappears after a minute and will not be shown again.
          </p>
          <button type="button" onClick={() => setFresh(null)}
            style={{
              padding: "0.8rem", borderRadius: 8, border: "1px solid #047857",
              background: "#047857", color: "#fff", fontWeight: 700, fontSize: "1rem",
              fontFamily: "inherit", cursor: "pointer"
            }}>
            Done
          </button>
        </section>
      )}

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

      {/* The PIN pad. One name, four digits; it goes on the fourth. */}
      {chosen && (
        <section style={{
          border: "1px solid #e5e7eb", borderRadius: 12, padding: "1.25rem",
          background: "#fff", display: "flex", flexDirection: "column",
          gap: "1rem", alignItems: "center", width: "100%", maxWidth: 420,
          margin: "0 auto", boxSizing: "border-box"
        }}>
          <strong style={{ fontSize: "1.5rem", textAlign: "center" }}>{chosen.name}</strong>
          <span className="muted" style={{ marginTop: "-0.6rem" }}>
            {clockingOut ? "PIN to clock out" : "PIN to clock in"}
          </span>

          <div ref={dotsRef} role="status" aria-label={`${pin.length} of 4 digits`}
            style={{ display: "flex", gap: "1.1rem", padding: "0.25rem 0" }}>
            {[0, 1, 2, 3].map(i => (
              <span key={i} style={{
                width: 22, height: 22, borderRadius: "50%",
                border: `2px solid ${pinMsg ? "#b91c1c" : "#111827"}`,
                background: i < pin.length ? (pinMsg ? "#b91c1c" : "#111827") : "transparent"
              }} />
            ))}
          </div>

          <div style={{ minHeight: "1.4em", color: "#b91c1c", fontWeight: 600, textAlign: "center" }}>
            {busy ? <span className="muted" style={{ fontWeight: 400 }}>Checking…</span> : pinMsg}
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "0.6rem", width: "100%" }}>
            {KEYS.map(k => {
              const word = k === "clear" || k === "back";
              return (
                <button key={k} type="button" onClick={() => press(k)} disabled={busy || locked}
                  style={{
                    minHeight: 72, borderRadius: 12, border: "1px solid #d1d5db",
                    background: word ? "#fff" : "#f9fafb", color: "#111827",
                    fontSize: word ? "1rem" : "1.75rem", fontWeight: word ? 600 : 700,
                    fontFamily: "inherit", touchAction: "manipulation",
                    cursor: busy ? "wait" : locked ? "not-allowed" : "pointer",
                    opacity: locked ? 0.5 : 1
                  }}>
                  {k === "clear" ? "Clear" : k === "back" ? "Back" : k}
                </button>
              );
            })}
          </div>

          <button type="button" onClick={closePad} disabled={busy}
            style={{
              width: "100%", padding: "0.9rem", borderRadius: 8, border: "1px solid #d1d5db",
              background: "#fff", fontWeight: 600, fontSize: "1rem",
              fontFamily: "inherit", cursor: busy ? "wait" : "pointer"
            }}>
            Cancel
          </button>
        </section>
      )}

      {/* The list of names. Full-width rows: this is used with a finger, often
          in a hurry, by somebody who has just walked in off the street. */}
      {!chosen && !adding && !fresh && (
        <div style={{
          display: "flex", flexDirection: "column", border: "1px solid #e5e7eb",
          borderRadius: 10, overflow: "hidden", background: "#fff"
        }}>
          {people.length === 0 && <p className="muted" style={{ margin: 0, padding: "1rem" }}>No staff to show.</p>}
          {people.map((p, i) => (
            <button key={p.id} type="button" onClick={() => choose(p)}
              style={{
                display: "flex", justifyContent: "space-between", alignItems: "center", gap: "1rem",
                width: "100%", minHeight: 64, padding: "0.85rem 1.1rem", textAlign: "left",
                border: "none", borderTop: i > 0 ? "1px solid #e5e7eb" : "none",
                borderLeft: `5px solid ${p.state === "IN" ? "#10b981" : "transparent"}`,
                background: "#fff", cursor: "pointer", fontFamily: "inherit",
                touchAction: "manipulation"
              }}>
              <span style={{ fontSize: "1.3rem", fontWeight: 700, color: "#111827", minWidth: 0, overflowWrap: "anywhere" }}>
                {p.name}
              </span>
              <span style={{
                fontSize: "1rem", fontWeight: 600, whiteSpace: "nowrap",
                color: p.state === "IN" ? "#047857" : "#9ca3af"
              }}>
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
