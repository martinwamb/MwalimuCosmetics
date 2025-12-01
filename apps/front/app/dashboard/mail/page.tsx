"use client";

import { useEffect, useState } from "react";

type MailMessage = {
  id: string;
  to: string;
  from: string;
  subject: string | null;
  body: string | null;
  direction: "INBOUND" | "OUTBOUND";
  status: "QUEUED" | "SENT" | "FAILED";
  createdAt: string;
};

const apiBase = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export default function MailDashboardPage() {
  const [messages, setMessages] = useState<MailMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadMail() {
      setLoading(true);
      setError(null);
      try {
        const token = typeof window !== "undefined" ? localStorage.getItem("mwalimu_token") : null;
        if (!token) {
          setError("Sign in to view your messages.");
          setLoading(false);
          return;
        }

        const res = await fetch(`${apiBase}/mail?take=50`, {
          headers: {
            Authorization: `Bearer ${token}`
          }
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error((data?.error as string) ?? "Unable to load messages.");
        }
        setMessages((data?.data as MailMessage[]) ?? []);
      } catch (err: any) {
        setError(err?.message ?? "Unable to load messages.");
      } finally {
        setLoading(false);
      }
    }

    loadMail();
  }, []);

  return (
    <div className="mail-stack">
      <div className="hero-eyebrow" style={{ marginBottom: "0.25rem" }}>
        Inbox from platform
      </div>
      <h1 style={{ margin: 0 }}>Messages sent to your account</h1>
      <p className="muted" style={{ marginTop: "0.35rem" }}>
        Password resets and platform notices appear here after they are sent to your email address.
      </p>

      {loading && <p className="muted">Loading messages...</p>}
      {error && <p className="signin-error">{error}</p>}

      {!loading && !error && messages.length === 0 && <p className="muted">No messages yet.</p>}

      <div className="mail-grid">
        {messages.map((msg) => (
          <article key={msg.id} className="card">
            <div className="mail-meta">
              <div className="pill subtle">{msg.direction === "OUTBOUND" ? "From platform" : "To platform"}</div>
              <div className="pill subtle">{msg.status}</div>
            </div>
            <h3 style={{ margin: "0.2rem 0" }}>{msg.subject ?? "(No subject)"}</h3>
            <p className="muted" style={{ margin: 0 }}>
              {msg.body?.slice(0, 160) ?? "No body"}
              {msg.body && msg.body.length > 160 ? "..." : ""}
            </p>
            <div className="mail-footer">
              <span className="muted small">{new Date(msg.createdAt).toLocaleString()}</span>
              <span className="muted small">To: {msg.to}</span>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
