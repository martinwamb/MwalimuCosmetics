"use client";

import { useEffect, useMemo, useState } from "react";

type Tag = {
  id: string;
  value: string;
  label: string;
  isSystem: boolean;
};

type TagGroup = {
  id: string;
  code: string;
  name: string;
  description?: string | null;
  selection: string;
  required: boolean;
  editable: boolean;
  tags?: Tag[];
};

const apiBase = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export default function TagAdminPage() {
  const [token, setToken] = useState<string | null>(null);
  const [groups, setGroups] = useState<TagGroup[]>([]);
  const [activeGroupId, setActiveGroupId] = useState<string | null>(null);
  const [form, setForm] = useState({ value: "", label: "" });
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    try {
      const saved = typeof window !== "undefined" ? localStorage.getItem("mwalimu_token") : null;
      setToken(saved);
    } catch {
      setToken(null);
    }
  }, []);

  async function loadGroups(authToken?: string | null) {
    if (!authToken) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${apiBase}/tags/groups?includeTags=true`, {
        headers: { Authorization: `Bearer ${authToken}` },
        cache: "no-store"
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data?.error as string) ?? "Could not load tag groups");
      const next = (data?.data as TagGroup[]) ?? [];
      setGroups(next);
      if (!activeGroupId && next.length) {
        setActiveGroupId(next[0].id);
      }
    } catch (err: any) {
      setError(err?.message ?? "Could not load tag groups.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadGroups(token);
  }, [token]);

  const activeGroup = useMemo(() => groups.find((group) => group.id === activeGroupId) ?? null, [groups, activeGroupId]);

  async function handleCreateTag(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus(null);
    setError(null);
    if (!token) {
      setError("Sign in as admin to edit tags.");
      return;
    }
    if (!activeGroup) {
      setError("Select a group first.");
      return;
    }
    if (!form.value.trim()) {
      setError("Value is required.");
      return;
    }

    try {
      const res = await fetch(`${apiBase}/tags/groups/${activeGroup.id}/tags`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          value: form.value.trim(),
          label: form.label.trim() || undefined
        })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data?.error as string) ?? "Could not create tag.");
      setStatus("Tag added.");
      setForm({ value: "", label: "" });
      await loadGroups(token);
    } catch (err: any) {
      setError(err?.message ?? "Could not create tag.");
    }
  }

  async function handleUpdateTag(tagId: string, label: string) {
    if (!token) {
      setError("Sign in as admin to edit tags.");
      return;
    }
    setSavingId(tagId);
    setStatus(null);
    setError(null);
    try {
      const res = await fetch(`${apiBase}/tags/${tagId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ label: label.trim() })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data?.error as string) ?? "Could not update tag.");
      setStatus("Tag updated.");
      await loadGroups(token);
    } catch (err: any) {
      setError(err?.message ?? "Could not update tag.");
    } finally {
      setSavingId(null);
    }
  }

  async function handleDeleteTag(tagId: string) {
    if (!token) {
      setError("Sign in as admin to edit tags.");
      return;
    }
    setSavingId(tagId);
    setStatus(null);
    setError(null);
    try {
      const res = await fetch(`${apiBase}/tags/${tagId}`, {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${token}`
        }
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data?.error as string) ?? "Could not delete tag.");
      setStatus("Tag deleted.");
      await loadGroups(token);
    } catch (err: any) {
      setError(err?.message ?? "Could not delete tag.");
    } finally {
      setSavingId(null);
    }
  }

  return (
    <div className="card">
      <div className="hero-eyebrow" style={{ marginBottom: "0.35rem" }}>
        Tag management
      </div>
      <h1 style={{ margin: 0 }}>Manage tag options</h1>
      <p className="muted" style={{ marginTop: "0.35rem" }}>
        Add or rename tags for editable groups (benefits, suitable for, ingredients). Fixed groups are read-only.
      </p>

      {!token && (
        <div className="signin-error" style={{ marginTop: "0.75rem" }}>
          Sign in as admin to edit tags.
        </div>
      )}
      {error && <div className="signin-error" style={{ marginTop: "0.75rem" }}>{error}</div>}
      {status && <div className="signin-success" style={{ marginTop: "0.75rem" }}>{status}</div>}

      <div style={{ display: "grid", gap: "1rem", marginTop: "1rem" }}>
        <label className="input-group">
          <span>Tag group</span>
          <select
            value={activeGroupId ?? ""}
            onChange={(e) => setActiveGroupId(e.target.value)}
            disabled={!groups.length}
          >
            {groups.map((group) => (
              <option key={group.id} value={group.id}>
                {group.name}
              </option>
            ))}
          </select>
        </label>

        {loading && <p className="muted">Loading tag options...</p>}

        {activeGroup && (
          <div className="card" style={{ padding: "0.9rem" }}>
            <div className="hero-eyebrow" style={{ marginBottom: "0.25rem" }}>
              {activeGroup.name} {activeGroup.editable ? "" : "(Fixed)"}
            </div>
            {activeGroup.tags?.length ? (
              <div style={{ display: "grid", gap: "0.5rem" }}>
                {activeGroup.tags.map((tag) => (
                  <div key={tag.id} className="input-row" style={{ alignItems: "center" }}>
                    <div className="input-group" style={{ flex: 2 }}>
                      <span>Label</span>
                      <input
                        defaultValue={tag.label}
                        disabled={!activeGroup.editable || tag.isSystem}
                        onBlur={(e) => {
                          const next = e.target.value.trim();
                          if (next && next !== tag.label) {
                            handleUpdateTag(tag.id, next);
                          }
                        }}
                      />
                    </div>
                    <div className="input-group" style={{ flex: 1 }}>
                      <span>Value</span>
                      <input value={tag.value} readOnly />
                    </div>
                    <button
                      className="button ghost"
                      type="button"
                      disabled={!activeGroup.editable || tag.isSystem || savingId === tag.id}
                      onClick={() => handleDeleteTag(tag.id)}
                    >
                      {savingId === tag.id ? "..." : "Delete"}
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="muted">No tags yet.</p>
            )}
          </div>
        )}

        <form className="card" onSubmit={handleCreateTag} style={{ padding: "0.9rem" }}>
          <div className="hero-eyebrow" style={{ marginBottom: "0.25rem" }}>
            Add a tag
          </div>
          <div className="input-row">
            <label className="input-group">
              <span>Value (lowercase, underscores)</span>
              <input
                value={form.value}
                onChange={(e) => setForm((prev) => ({ ...prev, value: e.target.value }))}
                placeholder="hydrating_plus"
              />
            </label>
            <label className="input-group">
              <span>Label (optional)</span>
              <input
                value={form.label}
                onChange={(e) => setForm((prev) => ({ ...prev, label: e.target.value }))}
                placeholder="Hydrating Plus"
              />
            </label>
          </div>
          <button className="button" type="submit" disabled={!activeGroup?.editable}>
            Add tag
          </button>
        </form>
      </div>
    </div>
  );
}
