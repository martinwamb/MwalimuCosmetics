"use client";

import { useEffect, useMemo, useState } from "react";

type Product = {
  id: string;
  name: string;
  description: string;
  price: number;
  sku?: string;
  imageUrl?: string | null;
  category?: string | null;
  stockQty?: number;
  tagline?: string;
  badge?: string;
  featured?: boolean;
};

const apiBase = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export const dynamic = "force-dynamic";

const fallbackCatalog: Product[] = [
  {
    id: "p-1",
    name: "Shea Body Butter",
    description: "Whipped, ultra-rich butter that leaves a soft, dewy finish without greasiness.",
    price: 15.5,
    tagline: "Deep moisture",
    badge: "Sample"
  },
  {
    id: "p-2",
    name: "Vitamin C Serum",
    description: "High-potency 15% C + hyaluronic acid serum for bright, even-toned skin.",
    price: 25.0,
    tagline: "Glow booster",
    badge: "Sample"
  },
  {
    id: "p-3",
    name: "Matte Lipstick Duo",
    description: "Two-piece long-wear matte lipstick kit with bold, conditioning pigment.",
    price: 18.0,
    tagline: "All-day color",
    badge: "Sample"
  }
];

export default function Page() {
  const [catalog, setCatalog] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [cart, setCart] = useState<Record<string, any>[]>([]);
  const [saved, setSaved] = useState<Record<string, any>[]>([]);

  useEffect(() => {
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`${apiBase}/products?status=ACTIVE&take=50`, { cache: "no-store" });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error((data?.error as string) ?? "Could not load products");
        }
        const items = (data?.data as any[]) ?? [];
        setCatalog(
          items.map((item) => ({
            id: item.id,
            name: item.name,
            description: item.description,
            price: item.price,
            sku: item.sku,
            imageUrl: item.imageUrl,
            category: item.category,
            stockQty: item.stockQty,
            tagline: item.category ?? "New arrival",
            badge: item.stockQty === 0 ? "Out of stock" : item.category ?? undefined,
            featured: item.featured
          }))
        );
      } catch (err: any) {
        console.error("[front] Failed to load products", err);
        setError(err?.message ?? "Unable to load products.");
        setCatalog(fallbackCatalog);
      } finally {
        setLoading(false);
      }
    }

    load();

    try {
      const storedCart = localStorage.getItem("mwalimu_cart");
      const storedSaved = localStorage.getItem("mwalimu_saved");
      if (storedCart) setCart(JSON.parse(storedCart));
      if (storedSaved) setSaved(JSON.parse(storedSaved));
    } catch {
      // ignore
    }
  }, []);

  function persist(key: string, value: any) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // ignore
    }
  }

  function handleAddToCart(product: Product) {
    const next = [...cart];
    const existing = next.findIndex((item) => item.id === product.id && item.price === product.price);
    if (existing >= 0) {
      next[existing].qty += 1;
    } else {
      next.push({ id: product.id, name: product.name, price: product.price, qty: 1 });
    }
    setCart(next);
    persist("mwalimu_cart", next);
    setNotice(`Added ${product.name} to cart.`);
    setTimeout(() => setNotice(null), 2000);
  }

  function handleSave(product: Product) {
    if (saved.find((item) => item.id === product.id)) {
      setNotice("Already saved.");
      setTimeout(() => setNotice(null), 1500);
      return;
    }
    const next = [...saved, { id: product.id, name: product.name, price: product.price }];
    setSaved(next);
    persist("mwalimu_saved", next);
    setNotice(`Saved ${product.name}.`);
    setTimeout(() => setNotice(null), 2000);
  }

  const usingFallback = useMemo(() => catalog.length === 0, [catalog]);
  const productsToShow = usingFallback ? fallbackCatalog : catalog;
  const featured = productsToShow.filter((p) => p.featured);
  const featuredRow = featured.length ? featured.slice(0, 3) : productsToShow.slice(0, 3);
  const categories = Array.from(new Set(productsToShow.map((p) => p.category).filter(Boolean) as string[])).slice(0, 8);

  function formatKES(value: number) {
    return new Intl.NumberFormat("en-KE", { style: "currency", currency: "KES", maximumFractionDigits: 2 }).format(value);
  }

  function normalizeImageUrl(url?: string | null) {
    if (!url) return null;
    const trimmed = url.trim();
    if (!trimmed) return null;
    // Allow data URLs straight through for previews/safe fallbacks.
    if (trimmed.startsWith("data:")) return trimmed;
    // Handle protocol-relative or relative paths from the API.
    if (trimmed.startsWith("//")) return `https:${trimmed}`;
    if (trimmed.startsWith("/")) return `${apiBase.replace(/\/$/, "")}${trimmed}`;
    // Force HTTPS for API host to avoid mixed-content blocks.
    if (trimmed.startsWith("http://api.mwalimucosmetics.com")) {
      return trimmed.replace("http://", "https://");
    }
    return trimmed;
  }

  return (
    <div>
      <section className="hero">
        <div className="hero-card">
          <div className="hero-eyebrow">Holiday-ready glow</div>
          <h1>Glow-worthy picks from Mwalimu Cosmetics</h1>
          <p className="muted">
            Rich butters, brightening serums, long-wear pigments, and thoughtful bundles that keep skin soft and color bold all season.
          </p>
          <div className="hero-actions">
            <button className="button">Shop bestsellers</button>
            <button className="button ghost">Build your kit</button>
          </div>
          <div className="hero-pill-row">
            <span className="mini-pill">Fast local delivery</span>
            <span className="mini-pill">Fresh stock, sealed</span>
            <span className="mini-pill">Easy returns</span>
          </div>
        </div>
        <div className="deal-card">
          <strong style={{ fontSize: "1.05rem" }}>Featured by admin</strong>
          <p className="muted" style={{ marginTop: "0.3rem" }}>
            Admin-selected products appear here. Update the product form to mark items as featured.
          </p>
          <div className="deal-grid">
            {featuredRow.map((product) => (
              <a key={product.id} className="deal-tile" style={{ alignItems: "flex-start", textDecoration: "none" }} href={`/products/${product.id}`}>
                <strong>{product.name}</strong>
                <p className="muted" style={{ margin: "0.35rem 0 0" }}>
                  {product.description}
                </p>
                <div className="muted small">{formatKES(product.price)}</div>
              </a>
            ))}
          </div>
        </div>
      </section>

      <div className="catalog-head">
        <div>
          <div className="hero-eyebrow" style={{ marginBottom: "0.25rem" }}>
            Products
          </div>
          <h2 style={{ margin: 0 }}>Bestsellers to soften skin and brighten color</h2>
        </div>
        <div className="filter-row">
          {(categories.length ? categories : ["Hydration", "Brightening", "Long-wear color"]).map((filter) => (
            <button key={filter} className="filter-chip">
              {filter}
            </button>
          ))}
        </div>
      </div>

      {usingFallback && (
        <p className="muted" style={{ marginTop: 0 }}>
          Live products will appear here once the catalog is set up. You are seeing sample items for now.
        </p>
      )}
      {error && <p className="signin-error">{error}</p>}
      {notice && <p className="signin-success">{notice}</p>}

      <div className="catalog-grid">
        {productsToShow.map((product) => {
          const img = normalizeImageUrl(product.imageUrl);
          return (
            <a
              className="product-card"
              key={product.id}
              href={`/products/${product.id}`}
              style={{ textDecoration: "none", color: "inherit" }}
            >
              {product.badge && <div className="badge">{product.badge}</div>}
              <div
                className="product-thumb"
                style={img ? { backgroundImage: `url(${img})`, backgroundSize: "cover", backgroundPosition: "center" } : undefined}
              >
                {!img && (product.tagline ?? "New arrival")}
              </div>
              <h3 style={{ margin: "0.25rem 0 0" }}>{product.name}</h3>
              <p className="muted" style={{ margin: 0 }}>
                {product.description}
              </p>
              <p className="price">{formatKES(product.price)}</p>
              <p className="muted small" style={{ margin: "0 0 0.35rem" }}>
                {product.category ? `Category: ${product.category}` : "Fresh stock ready"}
                {typeof product.stockQty === "number" ? ` • ${product.stockQty} in stock` : ""}
              </p>
              <div className="actions">
                <button
                  className="button full"
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    handleAddToCart(product);
                  }}
                >
                  Add to Cart
                </button>
                <button
                  className="button ghost full"
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    handleSave(product);
                  }}
                >
                  Save
                </button>
              </div>
            </a>
          );
        })}
      </div>

      <section className="signin-preview">
        <article className="card">
          <div className="hero-eyebrow" style={{ marginBottom: "0.4rem" }}>
            Customers
          </div>
          <h3 style={{ margin: 0 }}>Sign in to pick up where you left off</h3>
          <p className="muted" style={{ marginTop: "0.35rem" }}>
            See past orders, reorder routines, and follow every delivery without leaving the store.
          </p>
          <div className="tag-list">
            <span className="mini-pill">Past orders</span>
            <span className="mini-pill">Delivery updates</span>
            <span className="mini-pill">Saved routines</span>
          </div>
          <a className="text-link" href="/sign-in">
            Sign in to view your history
          </a>
        </article>
        <article className="card">
          <div className="hero-eyebrow" style={{ marginBottom: "0.4rem" }}>
            Staff
          </div>
          <h3 style={{ margin: 0 }}>Team console unlocks after sign-in</h3>
          <p className="muted" style={{ marginTop: "0.35rem" }}>
            Accounts, sales, admin, store, and delivery teams each get their own workspace plus a clock-in station.
          </p>
          <div className="tag-list">
            <span className="mini-pill">Accounts receivables</span>
            <span className="mini-pill">Sales dashboards</span>
            <span className="mini-pill">Store inventory</span>
            <span className="mini-pill">Delivery routing</span>
            <span className="mini-pill">Clock in/out</span>
          </div>
          <a className="text-link" href="/sign-in">
            Sign in as staff to continue
          </a>
        </article>
      </section>
    </div>
  );
}
