"use client";

import { useEffect, useState } from "react";

export function NavBar() {
  const [token, setToken] = useState<string | null>(null);
  const [role, setRole] = useState<string | null>(null);

  useEffect(() => {
    try {
      const savedToken = typeof window !== "undefined" ? localStorage.getItem("mwalimu_token") : null;
      const savedRole = typeof window !== "undefined" ? localStorage.getItem("mwalimu_role") : null;
      setToken(savedToken);
      setRole(savedRole);
    } catch {
      // ignore
    }
  }, []);

  const isLoggedIn = Boolean(token);
  const isAdmin = role === "ADMIN";

  return (
    <header className="header">
      <div className="nav-primary">
        <a href="/" className="brand">
          Mwalimu Cosmetics
        </a>
        <div className="search">
          <select aria-label="Category">
            <option>All beauty</option>
            <option>Skin care</option>
            <option>Hair</option>
            <option>Makeup</option>
          </select>
          <input placeholder="Search Mwalimu favorites..." aria-label="Search" />
          <button aria-label="Search products">Search</button>
        </div>
        <nav className="nav-links nav-actions">
          <a href="/">Home</a>
          <div className="language-switch" aria-label="Language">
            <span>EN</span>
            <span className="divider">|</span>
            <span>KE</span>
          </div>
          {isLoggedIn ? (
            <>
              {isAdmin && <a href="/dashboard/admin">Dashboard</a>}
              <a href="/orders">Orders</a>
              <a href="/cart">Cart</a>
            </>
          ) : (
            <>
              <a href="/sign-in">Sign in</a>
              <a href="/orders">Orders</a>
              <a href="/cart">Cart</a>
            </>
          )}
        </nav>
      </div>
      <div className="nav-sub">
        <div className="nav-sub-inner">
          <span>Skin care</span>
          <span>Makeup</span>
          <span>Hair</span>
          <span>Fragrance</span>
          <span>Gifts & Kits</span>
        </div>
      </div>
    </header>
  );
}
