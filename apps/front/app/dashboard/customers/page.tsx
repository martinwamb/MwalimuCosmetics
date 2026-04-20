"use client";

import { useCallback, useEffect, useState } from "react";

const apiBase = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

type Customer = {
  id: string;
  name: string;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  marketingOptIn: boolean;
  loyalty: number;
  orderCount: number;
  lastOrderAt: string | null;
  createdAt: string;
};

export default function CustomersPage() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  const load = useCallback(async () => {
    const token = localStorage.getItem("mwalimu_token");
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${apiBase}/customers`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error ?? "Failed to load customers");
      setCustomers(data.data ?? []);
    } catch (err: any) {
      setError(err?.message ?? "Failed to load customers");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function exportCsv() {
    const token = localStorage.getItem("mwalimu_token");
    if (!token) return;
    const res = await fetch(`${apiBase}/customers/export`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) { alert("Export failed"); return; }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "customers.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  const q = query.trim().toLowerCase();
  const displayed = q
    ? customers.filter(
        (c) =>
          c.name.toLowerCase().includes(q) ||
          (c.email ?? "").toLowerCase().includes(q) ||
          (c.phone ?? "").includes(q)
      )
    : customers;

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "1rem", flexWrap: "wrap", gap: "0.75rem" }}>
        <h1 style={{ margin: 0, fontSize: "1.35rem", fontWeight: 800, letterSpacing: "-0.02em" }}>
          Customers <span style={{ color: "var(--muted)", fontWeight: 600, fontSize: "1rem" }}>({customers.length})</span>
        </h1>
        <div style={{ display: "flex", gap: "0.5rem" }}>
          <button className="button ghost" onClick={load} style={{ fontSize: "0.85rem" }}>↻ Refresh</button>
          <button className="button ghost" onClick={exportCsv} style={{ fontSize: "0.85rem" }}>Export CSV</button>
        </div>
      </div>

      <input
        className="pos-search-input"
        style={{ marginBottom: "1rem", maxWidth: "360px", display: "block" }}
        placeholder="Search by name, email, or phone…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />

      {error && <div className="signin-error" style={{ marginBottom: "1rem" }}>{error}</div>}

      {loading ? (
        <div style={{ textAlign: "center", padding: "3rem", color: "var(--muted)" }}>Loading customers…</div>
      ) : (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Contact</th>
                <th>Orders</th>
                <th>Last order</th>
                <th>Loyalty pts</th>
                <th>Marketing</th>
                <th>Since</th>
              </tr>
            </thead>
            <tbody>
              {displayed.length === 0 && (
                <tr>
                  <td colSpan={7} style={{ textAlign: "center", color: "var(--muted)", padding: "2rem" }}>No customers found.</td>
                </tr>
              )}
              {displayed.map((c) => (
                <tr key={c.id}>
                  <td style={{ fontWeight: 700 }}>{c.name}</td>
                  <td style={{ fontSize: "0.85rem" }}>
                    {c.email && <div>{c.email}</div>}
                    {c.phone && <div style={{ color: "var(--muted)" }}>{c.phone}</div>}
                  </td>
                  <td style={{ fontWeight: 700 }}>{c.orderCount}</td>
                  <td style={{ color: "var(--muted)", fontSize: "0.85rem" }}>
                    {c.lastOrderAt ? new Date(c.lastOrderAt).toLocaleDateString("en-KE", { day: "numeric", month: "short" }) : "—"}
                  </td>
                  <td>{c.loyalty}</td>
                  <td>
                    <span className={`chip ${c.marketingOptIn ? "chip-green" : "chip-gray"}`}>
                      {c.marketingOptIn ? "Yes" : "No"}
                    </span>
                  </td>
                  <td style={{ color: "var(--muted)", fontSize: "0.82rem" }}>
                    {new Date(c.createdAt).toLocaleDateString("en-KE", { day: "numeric", month: "short", year: "numeric" })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
