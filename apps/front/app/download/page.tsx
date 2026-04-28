"use client";

import { useEffect, useState } from "react";

const steps = [
  {
    n: 1,
    title: "Download complete",
    body: "The file MwalimuSyncAgent.zip has been saved to your Downloads folder.",
  },
  {
    n: 2,
    title: "Extract the ZIP",
    body: 'Right-click MwalimuSyncAgent.zip → "Extract All…" → choose your Desktop as the destination.',
  },
  {
    n: 3,
    title: "Run the installer",
    body: 'Open the extracted folder. Right-click install.bat → "Run as Administrator". Click Yes on the UAC prompt.',
  },
  {
    n: 4,
    title: "Wait for completion",
    body: "The installer sets up Node.js (if needed), copies files to C:\\MwalimuSync, creates a scheduled task, and runs the first sync. A message confirming success will appear.",
  },
  {
    n: 5,
    title: "You're done",
    body: "The sync agent will now run automatically every 10 minutes. Sales data and products will appear in the dashboard at mwalimucosmetics.com/dashboard.",
  },
];

export default function DownloadPage() {
  const [downloaded, setDownloaded] = useState(false);

  useEffect(() => {
    // Auto-trigger download
    const a = document.createElement("a");
    a.href = "/MwalimuSyncAgent.zip";
    a.download = "MwalimuSyncAgent.zip";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => setDownloaded(true), 1200);
  }, []);

  return (
    <div style={{ minHeight: "100vh", background: "linear-gradient(135deg,#fef9e7 0%,#eef4ff 100%)", display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "3rem 1rem" }}>
      <div style={{ maxWidth: 560, width: "100%" }}>

        {/* Header card */}
        <div className="card" style={{ textAlign: "center", padding: "2rem", marginBottom: "1.25rem" }}>
          <div style={{ fontSize: "2.5rem", marginBottom: "0.75rem" }}>✅</div>
          <div style={{ fontWeight: 800, fontSize: "0.8rem", color: "var(--teal)", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: "0.5rem" }}>
            Mwalimu Cosmetics
          </div>
          <h1 style={{ margin: "0 0 0.5rem", fontSize: "1.6rem", fontWeight: 800, letterSpacing: "-0.02em" }}>
            {downloaded ? "Your download has started" : "Preparing download…"}
          </h1>
          <p className="muted" style={{ margin: "0 0 1.25rem" }}>
            MwalimuSyncAgent.zip is downloading. Follow the steps below to install it on this PC.
          </p>
          <a href="/MwalimuSyncAgent.zip" download="MwalimuSyncAgent.zip" className="button"
            style={{ textDecoration: "none", display: "inline-block" }}>
            Download again
          </a>
        </div>

        {/* Steps */}
        <div className="card" style={{ padding: "1.5rem" }}>
          <h2 style={{ margin: "0 0 1.25rem", fontSize: "1rem", fontWeight: 800 }}>Installation steps</h2>
          <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
            {steps.map(s => (
              <div key={s.n} style={{ display: "grid", gridTemplateColumns: "36px 1fr", gap: "0.75rem", alignItems: "flex-start" }}>
                <div style={{
                  width: 36, height: 36, borderRadius: "50%",
                  background: "var(--night)", color: "var(--gold)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontWeight: 800, fontSize: "0.85rem", flexShrink: 0,
                }}>
                  {s.n}
                </div>
                <div>
                  <div style={{ fontWeight: 700, fontSize: "0.92rem", marginBottom: "0.15rem" }}>{s.title}</div>
                  <div className="muted" style={{ fontSize: "0.88rem", lineHeight: 1.5 }}>{s.body}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Requirements note */}
        <div style={{ marginTop: "1rem", padding: "0.85rem 1rem", background: "#fff", border: "1px solid var(--border)", borderRadius: 12, fontSize: "0.85rem" }}>
          <strong>Requirements:</strong>
          <ul className="muted" style={{ margin: "0.35rem 0 0 1rem", padding: 0, lineHeight: 1.7 }}>
            <li>Windows 10 or later</li>
            <li>Connected to the office ethernet (to reach server-pc)</li>
            <li>Internet connection (to push data to the dashboard)</li>
            <li>Run as Administrator for the scheduled task to be created</li>
          </ul>
        </div>

        <div style={{ textAlign: "center", marginTop: "1.25rem" }}>
          <a href="/" className="text-link" style={{ fontSize: "0.85rem" }}>← Back to home</a>
        </div>
      </div>
    </div>
  );
}
