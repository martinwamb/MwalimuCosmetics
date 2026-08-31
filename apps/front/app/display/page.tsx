"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";

const apiBase = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

/**
 * The screen customers watch while they wait.
 *
 * A laptop drives a TV over HDMI, opens this fullscreen, and is left alone for
 * weeks. Every decision here follows from that:
 *
 *   * It NEVER goes blank. If the network drops it keeps the last numbers it
 *     had and carries on cycling photos, with one small dot to say so. A dark
 *     screen in a shop reads as "broken" and someone unplugs it.
 *
 *   * Photos are the default state and the numbers are modest, because most of
 *     the time nothing is happening. When a number BECOMES ready it takes the
 *     whole screen for a few seconds and then gets out of the way. That is the
 *     airport-board trick: the eye is pulled exactly when it matters, so the
 *     rest of the time the screen can be something worth looking at.
 *
 *   * It is silent. The shop already calls numbers over the speakers; a second
 *     source of noise saying the same thing is worse than none.
 *
 *   * Codes only. This is a public wall — no names, no amounts. The API does
 *     not send them.
 */

type Ready = { code: string; band: string; readyAt: string };
type Media = { id: string; url: string; caption: string | null };

const POLL_MS = 8000;
const SLIDE_MS = 9000;
const ANNOUNCE_MS = 9000;

/**
 * "E-042" becomes "E, zero four two".
 *
 * Lifted deliberately from bridge/tickets/announcer.js, which has always said
 * numbers this way, and the reasoning is worth keeping with the code: digits
 * are said ONE AT A TIME because "forty-two" and "forty-eight" are nearly the
 * same word across a busy shop with a fan running, and "four two" and "four
 * eight" are not. The band letter comes first because that is what is printed
 * largest on the slip.
 *
 * The shop has been hearing this phrasing for weeks. A screen that called
 * numbers differently would be a second, competing convention.
 */
const DIGITS: Record<string, string> = {
  "0": "zero", "1": "one", "2": "two", "3": "three", "4": "four",
  "5": "five", "6": "six", "7": "seven", "8": "eight", "9": "nine"
};

function speakable(code: string) {
  const [band, seq = ""] = String(code).split("-");
  return band + ", " + seq.split("").map(d => DIGITS[d] ?? d).join(" ");
}

function phraseFor(code: string) {
  return "Ticket " + speakable(code) + ", your goods are ready for collection.";
}

// useSearchParams opts the tree out of prerendering, and Next will not build
// the page unless that bail-out sits behind a Suspense boundary. The fallback
// is the same dark ground the screen uses, so a TV showing this mid-load looks
// like a screen waking up rather than a page that failed.
export default function DisplayPage() {
  return (
    <Suspense fallback={<Fill>Starting…</Fill>}>
      <DisplayScreen />
    </Suspense>
  );
}

function DisplayScreen() {
  const params = useSearchParams();
  const key = params?.get("key") ?? "";
  const slideMs = Number(params?.get("secs") ?? 0) * 1000 || SLIDE_MS;

  const [ready, setReady] = useState<Ready[]>([]);
  const [preparing, setPreparing] = useState(0);
  const [media, setMedia] = useState<Media[]>([]);
  const [slide, setSlide] = useState(0);
  const [online, setOnline] = useState(true);
  const [denied, setDenied] = useState(false);
  const [announcing, setAnnouncing] = useState<string | null>(null);

  // Sound is off until somebody touches the screen once.
  //
  // Not a preference — a browser rule. Audio and speech are blocked until a
  // page has had a real user gesture, so a display that simply started talking
  // on load would be silent and give no clue why. The prompt is the only
  // interaction this screen ever needs, and it is asked for plainly.
  const muted = params?.get("mute") === "1";
  const [soundReady, setSoundReady] = useState(false);
  const audioRef = useRef<AudioContext | null>(null);

  // Codes already seen as ready. Used to spot NEW ones — and seeded on the
  // first successful poll rather than left empty, or opening the page would
  // announce every number already on the board, one after another.
  const seen = useRef<Set<string> | null>(null);
  const queue = useRef<string[]>([]);

  const load = useCallback(async () => {
    if (!key) return;
    try {
      const r = await fetch(`${apiBase}/display/state?key=${encodeURIComponent(key)}`, { cache: "no-store" });
      if (r.status === 401) { setDenied(true); setOnline(true); return; }
      if (!r.ok) throw new Error(String(r.status));

      const { data } = await r.json();
      setDenied(false);
      setOnline(true);
      setReady(data.ready ?? []);
      setPreparing(data.preparing ?? 0);
      setMedia(data.media ?? []);

      const codes: string[] = (data.ready ?? []).map((t: Ready) => t.code);
      if (seen.current === null) {
        seen.current = new Set(codes);
      } else {
        for (const c of codes) {
          if (!seen.current.has(c)) {
            seen.current.add(c);
            queue.current.push(c);
          }
        }
      }
    } catch {
      // Keep whatever is on screen. A shop screen that blanks on a dropped
      // packet is worse than one showing numbers a minute old.
      setOnline(false);
    }
  }, [key]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const t = setInterval(load, POLL_MS);
    return () => clearInterval(t);
  }, [load]);

  // Photo cycle.
  useEffect(() => {
    if (media.length < 2) return;
    const t = setInterval(() => setSlide(s => (s + 1) % media.length), slideMs);
    return () => clearInterval(t);
  }, [media.length, slideMs]);

  // One announcement at a time, in the order they became ready.
  useEffect(() => {
    const t = setInterval(() => {
      setAnnouncing(cur => {
        if (cur) return cur;
        return queue.current.length ? queue.current.shift() ?? null : null;
      });
    }, 700);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!announcing) return;
    const t = setTimeout(() => setAnnouncing(null), ANNOUNCE_MS);
    return () => clearTimeout(t);
  }, [announcing]);

  // ── Calling the number out loud ───────────────────────────────────
  //
  // This screen is plugged into the shop's speakers, so it is what calls
  // numbers now. The announcer on the other machine runs with --no-speak and
  // keeps doing the parts only it can: claiming QR scans and messaging
  // customers on Telegram. One caller, in the room the customers are in.

  const enableSound = useCallback(() => {
    try {
      const Ctor = window.AudioContext ?? (window as any).webkitAudioContext;
      if (Ctor) {
        if (!audioRef.current) audioRef.current = new Ctor();
        audioRef.current?.resume();
      }
      // Speech needs the gesture too. An empty utterance is the usual way to
      // spend it without saying anything.
      if (typeof speechSynthesis !== "undefined") {
        speechSynthesis.speak(new SpeechSynthesisUtterance(""));
      }
      setSoundReady(true);
    } catch {
      // A screen that cannot make a sound still shows the numbers, which is
      // most of its job.
      setSoundReady(true);
    }
  }, []);

  useEffect(() => {
    if (soundReady || muted) return;
    const go = () => enableSound();
    window.addEventListener("pointerdown", go, { once: true });
    window.addEventListener("keydown", go, { once: true });
    return () => {
      window.removeEventListener("pointerdown", go);
      window.removeEventListener("keydown", go);
    };
  }, [soundReady, muted, enableSound]);

  useEffect(() => {
    if (!announcing || !soundReady || muted) return;

    let cancelled = false;

    // Two beeps before the words. People do not look up at the start of a
    // sentence, so without a chime the ticket number is the part that gets
    // missed — the same reason the speaker announcer plays one.
    const chime = () => {
      const ctx = audioRef.current;
      if (!ctx) return;
      const at = ctx.currentTime;
      [[880, 0, 0.18], [1170, 0.2, 0.22]].forEach(([hz, delay, dur]) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.frequency.value = hz;
        // Ramped rather than switched, because an abrupt stop on a square
        // edge is an audible click through a shop amplifier.
        gain.gain.setValueAtTime(0.0001, at + delay);
        gain.gain.exponentialRampToValueAtTime(0.25, at + delay + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, at + delay + dur);
        osc.connect(gain).connect(ctx.destination);
        osc.start(at + delay);
        osc.stop(at + delay + dur + 0.02);
      });
    };

    const say = (text: string) => {
      if (typeof speechSynthesis === "undefined") return;
      const u = new SpeechSynthesisUtterance(text);
      u.rate = 0.9;      // the announcer runs its synthesiser one notch slow
      u.volume = 1;
      speechSynthesis.speak(u);
    };

    try {
      chime();
      const phrase = phraseFor(announcing);
      // Said twice, because somebody who looked up on the chime has already
      // missed half of the first one.
      const t1 = setTimeout(() => { if (!cancelled) say(phrase); }, 500);
      const t2 = setTimeout(() => { if (!cancelled) say(phrase); }, 4200);
      return () => { cancelled = true; clearTimeout(t1); clearTimeout(t2); };
    } catch {
      return () => { cancelled = true; };
    }
  }, [announcing, soundReady, muted]);

  if (!key) return <Fill>Add ?key= to the address to start this screen.</Fill>;
  if (denied) return <Fill>That display key is not recognised.</Fill>;

  const current = media.length ? media[slide % media.length] : null;

  return (
    // Fixed over everything, so the site's own header is not on the wall.
    <div style={{
      position: "fixed", inset: 0, zIndex: 9999, display: "flex",
      background: "#0b0f14", color: "#fff",
      fontFamily: "system-ui, -apple-system, Segoe UI, sans-serif", overflow: "hidden"
    }}>
      {/* ── The queue ─────────────────────────────────────────── */}
      <aside style={{
        width: "34%", minWidth: 280, padding: "3vh 2vw",
        display: "flex", flexDirection: "column", gap: "2vh",
        borderRight: "1px solid rgba(255,255,255,0.08)"
      }}>
        <div style={{
          fontSize: "2.2vw", letterSpacing: "0.18em", textTransform: "uppercase",
          color: "#10b981", fontWeight: 700
        }}>
          Ready
        </div>

        <div style={{
          display: "flex", flexWrap: "wrap", gap: "1.2vh 1.2vw",
          alignContent: "flex-start", flex: 1, overflow: "hidden"
        }}>
          {ready.length === 0 && (
            <div style={{ fontSize: "1.6vw", color: "rgba(255,255,255,0.35)" }}>
              Nothing waiting to be collected.
            </div>
          )}
          {ready.map(t => (
            <div key={t.code} style={{
              fontSize: "4.4vw", fontWeight: 800, lineHeight: 1.05,
              letterSpacing: "-0.02em", fontVariantNumeric: "tabular-nums"
            }}>
              {t.code}
            </div>
          ))}
        </div>

        <div style={{ fontSize: "1.5vw", color: "rgba(255,255,255,0.45)" }}>
          {preparing} {preparing === 1 ? "order" : "orders"} being prepared
        </div>
      </aside>

      {/* ── The photos ────────────────────────────────────────── */}
      <main style={{ flex: 1, position: "relative", background: "#000" }}>
        {media.map((m, i) => (
          <img
            key={m.id}
            src={m.url}
            alt=""
            style={{
              position: "absolute", inset: 0, width: "100%", height: "100%",
              objectFit: "cover",
              opacity: i === (slide % Math.max(media.length, 1)) ? 1 : 0,
              transition: "opacity 1.2s ease-in-out"
            }}
          />
        ))}

        {!current && (
          <div style={{
            position: "absolute", inset: 0, display: "flex",
            alignItems: "center", justifyContent: "center",
            color: "rgba(255,255,255,0.25)", fontSize: "2vw", textAlign: "center", padding: "4vw"
          }}>
            Mwalimu Cosmetics
          </div>
        )}

        {current?.caption && (
          <div style={{
            position: "absolute", left: 0, right: 0, bottom: 0,
            padding: "4vh 3vw 3vh",
            background: "linear-gradient(to top, rgba(0,0,0,0.75), transparent)",
            fontSize: "2vw", fontWeight: 600
          }}>
            {current.caption}
          </div>
        )}
      </main>

      {/* ── A number that has just become ready ───────────────── */}
      {announcing && (
        <div style={{
          position: "absolute", inset: 0, zIndex: 10,
          background: "rgba(4,120,87,0.97)",
          display: "flex", flexDirection: "column",
          alignItems: "center", justifyContent: "center", gap: "2vh"
        }}>
          <div style={{
            fontSize: "3vw", letterSpacing: "0.2em", textTransform: "uppercase", opacity: 0.85
          }}>
            Ready for collection
          </div>
          <div style={{
            fontSize: "22vw", fontWeight: 800, lineHeight: 1,
            letterSpacing: "-0.03em", fontVariantNumeric: "tabular-nums"
          }}>
            {announcing}
          </div>
        </div>
      )}

      {/* Asked once, plainly, and then never again.
          A screen that is meant to call numbers and is silent looks broken, and
          the reason — a browser rule about audio needing a gesture — is not
          something anyone should have to guess at from across a shop. */}
      {!soundReady && !muted && (
        <button type="button" onClick={enableSound}
          style={{
            position: "absolute", left: "50%", bottom: "3vh", transform: "translateX(-50%)",
            zIndex: 30, cursor: "pointer", fontFamily: "inherit",
            padding: "1.2vh 2vw", borderRadius: 999,
            border: "1px solid rgba(255,255,255,0.35)",
            background: "rgba(0,0,0,0.55)", color: "#fff",
            fontSize: "1.4vw", letterSpacing: "0.04em"
          }}>
          Tap once to let this screen call the numbers
        </button>
      )}

      {/* Small enough to ignore, visible enough to explain a stale screen. */}
      {!online && (
        <div title="reconnecting" style={{
          position: "absolute", right: "1vw", bottom: "1vh",
          width: "0.7vw", height: "0.7vw", minWidth: 8, minHeight: 8,
          borderRadius: "50%", background: "#f59e0b", opacity: 0.8, zIndex: 20
        }} />
      )}
    </div>
  );
}

function Fill({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 9999,
      background: "#0b0f14", color: "rgba(255,255,255,0.6)",
      display: "flex", alignItems: "center", justifyContent: "center",
      fontFamily: "system-ui, sans-serif", fontSize: "1.6vw", padding: "4vw", textAlign: "center"
    }}>
      {children}
    </div>
  );
}
