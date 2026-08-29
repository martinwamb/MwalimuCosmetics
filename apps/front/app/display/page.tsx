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
