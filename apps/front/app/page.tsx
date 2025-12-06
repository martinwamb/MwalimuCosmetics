"use client";

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

import { useEffect, useMemo, useState } from "react";

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
        if (!res.ok) throw new Error((data?.error as string) ?? "Could not load products");
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
            badge: item.stockQty === 0 ? "Out of stock" : item.category ?? undefined
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
    const next = [...cart, { id: product.id, name: product.name, price: product.price, qty: 1 }];
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
          <strong style={{ fontSize: "1.05rem" }}>Why shoppers sign in</strong>
          <p className="muted" style={{ marginTop: "0.3rem" }}>
            Save favorites, reorder in one tap, check delivery statuses, and unlock staff consoles when you log in as team.
          </p>
          <div className="deal-grid">
            {[
              { title: "Track deliveries", hint: "Live status for every parcel" },
              { title: "See past orders", hint: "Buy again from your routine" },
              { title: "Staff workspace", hint: "Accounts, sales, store, delivery" },
              { title: "Clock in/out", hint: "Staff attendance after sign-in" }
            ].map((tile) => (
              <div key={tile.title} className="deal-tile">
                <strong>{tile.title}</strong>
                <p className="muted" style={{ margin: "0.35rem 0 0" }}>
                  {tile.hint}
                </p>
              </div>
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
          {["Hydration", "Brightening", "Long-wear color", "Bundles", "Under $25"].map((filter) => (
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
        {productsToShow.map((product) => (
          <article className="product-card" key={product.id}>
            {product.badge && <div className="badge">{product.badge}</div>}
            <div
              className="product-thumb"
              style={
                product.imageUrl
                  ? { backgroundImage: `url(${product.imageUrl})`, backgroundSize: "cover", backgroundPosition: "center" }
                  : undefined
              }
            >
              {!product.imageUrl && (product.tagline ?? "New arrival")}
            </div>
            <h3 style={{ margin: "0.25rem 0 0" }}>{product.name}</h3>
            <p className="muted" style={{ margin: 0 }}>
              {product.description}
            </p>
            <p className="price">
              USD <span style={{ fontSize: "1.1rem" }}>{product.price.toFixed(2)}</span>
            </p>
            <p className="muted small" style={{ margin: "0 0 0.35rem" }}>
              {product.category ? `Category: ${product.category}` : "Fresh stock ready"}
              {typeof product.stockQty === "number" ? ` • ${product.stockQty} in stock` : ""}
            </p>
            <div className="actions">
              <button className="button full" onClick={() => handleAddToCart(product)}>
                Add to Cart
              </button>
              <button className="button ghost full" onClick={() => handleSave(product)}>
                Save
              </button>
            </div>
          </article>
        ))}
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
