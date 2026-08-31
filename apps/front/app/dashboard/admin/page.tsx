"use client";

import { useCallback, useEffect, useState } from "react";

const apiBase = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

// What the shop screen is fed. Big enough for a 1080p TV with room to spare,
// small enough that a photo taken on a phone stops being a six-megabyte upload
// over shop internet.
const MAX_EDGE = 1600;
const JPEG_QUALITY = 0.82;

type Media = { id: string; url: string; caption: string | null; enabled: boolean; sortOrder: number };

/**
 * Shrink a photo in the browser before it is uploaded.
 *
 * The alternative is resizing on the server, which means a native image
 * library in the deploy and the full original crossing the shop's internet
 * first. Doing it here costs nothing on either side: the canvas is already in
 * every browser, and the existing /uploads endpoint takes exactly the base64
 * data URL that canvas.toDataURL produces, so no new upload plumbing is needed.
 *
 * A phone photo of about 6MB comes out around 300KB.
 */
function shrink(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read that file"));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("That file is not an image"));
      img.onload = () => {
        const scale = Math.min(1, MAX_EDGE / Math.max(img.width, img.height));
        const w = Math.round(img.width * scale);
        const h = Math.round(img.height * scale);

        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (!ctx) { reject(new Error("Canvas unavailable")); return; }

        // White underneath, because a PNG with transparency becomes black on
        // a JPEG otherwise and product cut-outs are exactly the case here.
        ctx.fillStyle = "#fff";
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);

        resolve(canvas.toDataURL("image/jpeg", JPEG_QUALITY));
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}

export default function AdminPage() {
  const [token, setToken] = useState("");
  const [media, setMedia] = useState<Media[]>([]);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [displayKey, setDisplayKey] = useState("mwalimu-display");

  useEffect(() => { setToken(localStorage.getItem("mwalimu_token") ?? ""); }, []);

  const load = useCallback(() => {
    if (!token) return;
    fetch(`${apiBase}/display/media`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.ok ? r.json() : Promise.reject(new Error(String(r.status))))
      .then(d => { setMedia(d.data ?? []); setNote(null); })
      .catch(e => setNote(
        // Say which of the two it is. A stale sign-in and a broken server look
        // identical from here otherwise, and the first is the likely one — the
        // dashboard shell signs you out on a 401, but this can land first.
        e.message === "401"
          ? "Your sign-in has expired. Sign out and back in."
          : "Could not load the photo list."));
  }, [token]);

  useEffect(() => { load(); }, [load]);

  async function addFiles(files: FileList | null) {
    if (!files || !files.length) return;
    setBusy(true);
    setNote(null);
    let added = 0;

    for (const file of Array.from(files)) {
      try {
        const dataUrl = await shrink(file);

        const up = await fetch(`${apiBase}/uploads`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ filename: file.name, data: dataUrl })
        });
        if (!up.ok) throw new Error("upload " + up.status);
        const { url } = await up.json();

        const rec = await fetch(`${apiBase}/display/media`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ url })
        });
        if (!rec.ok) throw new Error("save " + rec.status);
        added++;
      } catch (e: any) {
        setNote(`${file.name} did not upload (${e.message}).`);
      }
    }

    setBusy(false);
    if (added) setNote(`${added} photo${added === 1 ? "" : "s"} added.`);
    load();
  }

  async function patch(id: string, body: any) {
    await fetch(`${apiBase}/display/media/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(body)
    }).catch(() => {});
    load();
  }

  async function remove(id: string) {
    await fetch(`${apiBase}/display/media/${id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` }
    }).catch(() => {});
    load();
  }

  // Swapping sortOrder with the neighbour is enough for a handful of photos,
  // and needs no drag-and-drop library on a page somebody opens twice a month.
  async function move(i: number, delta: number) {
    const j = i + delta;
    if (j < 0 || j >= media.length) return;
    const a = media[i], b = media[j];
    await patch(a.id, { sortOrder: b.sortOrder });
    await patch(b.id, { sortOrder: a.sortOrder });
  }

  const displayUrl = typeof window !== "undefined"
    ? `${window.location.origin}/display?key=${encodeURIComponent(displayKey)}`
    : "";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
      <div>
        <h2 style={{ margin: 0, fontWeight: 800, letterSpacing: "-0.02em" }}>Shop Screen</h2>
        <p className="muted" style={{ margin: 0 }}>
          The display customers watch while they wait — collection numbers, and these photos.
        </p>
      </div>

      {/* How to put it on the TV */}
      <section style={{ border: "1px solid #e5e7eb", borderRadius: 8, padding: "1rem", background: "#fff" }}>
        <strong style={{ fontSize: "0.95rem" }}>Putting it on the screen</strong>
        <ol className="muted" style={{ fontSize: "0.88rem", margin: "0.5rem 0 0.75rem", paddingLeft: "1.1rem" }}>
          <li>Connect the laptop to the TV with HDMI.</li>
          <li>Open the address below in the browser.</li>
          <li>Press F11 for fullscreen. Leave it — it looks after itself.</li>
        </ol>
        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "center" }}>
          <input value={displayKey} onChange={e => setDisplayKey(e.target.value)}
            className="filter-input" style={{ width: "12rem" }} aria-label="Display key" />
          <code style={{ fontSize: "0.82rem", background: "#f3f4f6", padding: "0.4rem 0.6rem",
            borderRadius: 6, wordBreak: "break-all" }}>{displayUrl}</code>
          <button type="button" onClick={() => navigator.clipboard?.writeText(displayUrl)}
            className="filter-input" style={{ cursor: "pointer", background: "none" }}>Copy</button>
        </div>
        <p className="muted" style={{ fontSize: "0.78rem", margin: "0.5rem 0 0" }}>
          The key must match DISPLAY_KEY on the server. It exists so the screen never
          needs anyone to stay signed in, and it shows ticket numbers only — no
          customer names and no amounts.
        </p>
      </section>

      {/* Photos */}
      <section style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "0.5rem" }}>
          <strong style={{ fontSize: "0.95rem" }}>Photos ({media.length})</strong>
          <label className="filter-input" style={{ cursor: busy ? "wait" : "pointer", background: "none" }}>
            {busy ? "Uploading…" : "Add photos"}
            <input type="file" accept="image/*" multiple hidden disabled={busy}
              onChange={e => { addFiles(e.target.files); e.target.value = ""; }} />
          </label>
        </div>

        {note && <div className="muted" style={{ fontSize: "0.85rem" }}>{note}</div>}

        <p className="muted" style={{ fontSize: "0.78rem", margin: 0 }}>
          Photos are shrunk on this computer before they are sent, so a picture straight
          off a phone uploads in a second. Landscape works best — the screen fills the
          space and crops the edges.
        </p>

        {media.length === 0 && (
          <p className="muted" style={{ fontSize: "0.88rem" }}>
            No photos yet. The screen shows the collection numbers on their own until you add some.
          </p>
        )}

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))", gap: "0.75rem" }}>
          {media.map((m, i) => (
            <figure key={m.id} style={{
              margin: 0, border: "1px solid #e5e7eb", borderRadius: 8, overflow: "hidden",
              background: "#fff", opacity: m.enabled ? 1 : 0.45
            }}>
              <img src={m.url} alt="" style={{ width: "100%", height: 120, objectFit: "cover", display: "block" }} />
              <figcaption style={{ padding: "0.5rem", display: "flex", flexDirection: "column", gap: "0.4rem" }}>
                <input
                  defaultValue={m.caption ?? ""}
                  placeholder="Caption (optional)"
                  className="filter-input"
                  style={{ fontSize: "0.8rem" }}
                  onBlur={e => { if (e.target.value !== (m.caption ?? "")) patch(m.id, { caption: e.target.value }); }}
                />
                <div style={{ display: "flex", gap: "0.3rem", flexWrap: "wrap" }}>
                  <Mini onClick={() => move(i, -1)} disabled={i === 0}>←</Mini>
                  <Mini onClick={() => move(i, 1)} disabled={i === media.length - 1}>→</Mini>
                  <Mini onClick={() => patch(m.id, { enabled: !m.enabled })}>
                    {m.enabled ? "Hide" : "Show"}
                  </Mini>
                  <Mini onClick={() => remove(m.id)} danger>Remove</Mini>
                </div>
              </figcaption>
            </figure>
          ))}
        </div>
      </section>
    </div>
  );
}

function Mini({ children, onClick, disabled, danger }: {
  children: React.ReactNode; onClick: () => void; disabled?: boolean; danger?: boolean;
}) {
  return (
    <button type="button" onClick={onClick} disabled={disabled}
      style={{
        padding: "0.25rem 0.5rem", borderRadius: 5, fontSize: "0.76rem", fontFamily: "inherit",
        border: "1px solid " + (danger ? "#fca5a5" : "#d1d5db"),
        background: "none", color: danger ? "#b91c1c" : "#374151",
        cursor: disabled ? "default" : "pointer", opacity: disabled ? 0.4 : 1
      }}>
      {children}
    </button>
  );
}
