"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";

type Product = {
  id: string;
  slug?: string | null;
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

function HomePage() {
  const [catalog, setCatalog] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [cart, setCart] = useState<Record<string, any>[]>([]);
  const [saved, setSaved] = useState<Record<string, any>[]>([]);
  const searchParams = useSearchParams();

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
            slug: item.slug,
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
      if (key === "mwalimu_cart") {
        window.dispatchEvent(new Event("mwalimu-cart-updated"));
      }
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
      next.push({ id: product.id, slug: product.slug, name: product.name, price: product.price, qty: 1 });
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
  const searchQuery = useMemo(() => (searchParams?.get("q") ?? "").trim(), [searchParams]);
  const normalizedQuery = searchQuery.toLowerCase();
  const filteredProducts = useMemo(
    () =>
      normalizedQuery
        ? productsToShow.filter((product) => {
            const haystack = `${product.name} ${product.description ?? ""} ${product.category ?? ""} ${product.sku ?? ""}`.toLowerCase();
            return haystack.includes(normalizedQuery);
          })
        : productsToShow,
    [productsToShow, normalizedQuery]
  );
  const visibleProducts = filteredProducts;
  const recommendations = useMemo(() => {
    const pool = featured.length ? featured : productsToShow;
    return pool.slice(0, 4);
  }, [featured, productsToShow]);

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
              <a
                key={product.id}
                className="deal-tile"
                style={{ alignItems: "flex-start", textDecoration: "none" }}
                href={`/products/${product.slug ?? product.id}`}
              >
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
      {loading && <p className="muted">Loading products...</p>}
      {error && <p className="signin-error">{error}</p>}
      {notice && <p className="signin-success">{notice}</p>}

      {searchQuery && (
        <div className="card" style={{ padding: "0.85rem 1rem", margin: "0.5rem 0" }}>
          <strong>
            Showing results for &quot;
            {searchQuery}
            &quot;
          </strong>
          <p className="muted small" style={{ margin: "0.2rem 0 0" }}>
            {visibleProducts.length
              ? `${visibleProducts.length} match${visibleProducts.length === 1 ? "" : "es"} found`
              : "No exact matches. Here are a few recommendations instead."}
          </p>
        </div>
      )}

      {searchQuery && visibleProducts.length === 0 && (
        <div className="card" style={{ marginBottom: "0.75rem" }}>
          <div className="hero-eyebrow" style={{ marginBottom: "0.35rem" }}>
            Recommended while we look for that item
          </div>
          <div className="catalog-grid">
            {recommendations.map((product) => {
              const img = normalizeImageUrl(product.imageUrl);
              return (
                <a
                  className="product-card"
                  key={product.id}
                  href={`/products/${product.slug ?? product.id}`}
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
                </a>
              );
            })}
          </div>
        </div>
      )}

      <div className="catalog-grid">
        {visibleProducts.map((product) => {
          const img = normalizeImageUrl(product.imageUrl);
          const stockQty = typeof product.stockQty === "number" ? product.stockQty : null;
          const lowStock = stockQty !== null && stockQty > 0 && stockQty <= 6;
          const outOfStock = stockQty === 0;
          return (
            <a
              className="product-card"
              key={product.id}
              href={`/products/${product.slug ?? product.id}`}
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
              </p>
              <div className="muted small" style={{ marginBottom: "0.35rem", display: "flex", flexDirection: "column", gap: "0.15rem" }}>
                {stockQty !== null && (
                  <span>
                    Stock: {stockQty} {stockQty === 1 ? "unit" : "units"}
                  </span>
                )}
                {lowStock && <span className="stock-flag low">Only {stockQty} left in stock - order soon.</span>}
                {outOfStock && <span className="stock-flag out">Out of stock</span>}
              </div>
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

export default function Page() {
  return (
    <Suspense fallback={<p className="muted">Loading page...</p>}>
      <HomePage />
    </Suspense>
  );
}
