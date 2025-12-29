"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";

export function NavBar() {
  const [token, setToken] = useState<string | null>(null);
  const [role, setRole] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [cartCount, setCartCount] = useState(0);
  const router = useRouter();
  const searchParams = useSearchParams();

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

  useEffect(() => {
    const q = searchParams?.get("q") ?? "";
    setSearchTerm(q);
  }, [searchParams]);

  useEffect(() => {
    function syncCartCount() {
      try {
        const raw = typeof window !== "undefined" ? localStorage.getItem("mwalimu_cart") : null;
        const parsed = raw ? JSON.parse(raw) : [];
        const count = Array.isArray(parsed) ? parsed.reduce((sum, item) => sum + Number(item?.qty ?? 0), 0) : 0;
        setCartCount(Number.isFinite(count) ? count : 0);
      } catch {
        setCartCount(0);
      }
    }

    syncCartCount();
    const onStorage = (event: StorageEvent) => {
      if (event.key === "mwalimu_cart") syncCartCount();
    };
    const onCartUpdate = () => syncCartCount();
    window.addEventListener("storage", onStorage);
    window.addEventListener("mwalimu-cart-updated", onCartUpdate);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("mwalimu-cart-updated", onCartUpdate);
    };
  }, []);

  function handleSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = searchTerm.trim();
    if (trimmed) {
      router.push(`/?q=${encodeURIComponent(trimmed)}`);
    } else {
      router.push("/");
    }
  }

  const isLoggedIn = Boolean(token);
  const isAdmin = role === "ADMIN";

  function handleSignOut() {
    try {
      localStorage.removeItem("mwalimu_token");
      localStorage.removeItem("mwalimu_role");
    } catch {
      // ignore
    }
    setToken(null);
    setRole(null);
    router.push("/sign-in");
  }

  return (
    <header className="header">
      <div className="nav-primary">
        <a href="/" className="brand">
          Mwalimu Cosmetics
        </a>
        <form className="search" onSubmit={handleSearch} role="search">
          <select aria-label="Category">
            <option value="all">All beauty</option>
            <option value="skin">Skin care</option>
            <option value="hair">Hair</option>
            <option value="makeup">Makeup</option>
          </select>
          <input
            placeholder="Search Mwalimu favorites..."
            aria-label="Search"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
          <button aria-label="Search products" type="submit">
            Search
          </button>
        </form>
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
              <a href="/cart" className="cart-link">
                Cart
                {cartCount > 0 && <span className="cart-badge">{cartCount}</span>}
              </a>
              <button className="nav-link-button" type="button" onClick={handleSignOut}>
                Sign out
              </button>
            </>
          ) : (
            <>
              <a href="/sign-in">Sign in</a>
              <a href="/orders">Orders</a>
              <a href="/cart" className="cart-link">
                Cart
                {cartCount > 0 && <span className="cart-badge">{cartCount}</span>}
              </a>
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
