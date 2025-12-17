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

type Banner = {
  id: string;
  title: string;
  subtext?: string | null;
  ctaText?: string | null;
  ctaLink?: string | null;
  imageUrl: string;
  enabled: boolean;
  sortOrder: number;
};

type SectionItem = {
  id: string;
  label: string;
  imageUrl?: string | null;
  linkType?: "URL" | "CATEGORY" | "PRODUCT" | "FILTER";
  linkTarget?: string | null;
  badge?: string | null;
  sortOrder?: number;
};

type Section = {
  id: string;
  type: "CATEGORY" | "NEED" | "FEATURED_COLLECTION" | "BEST_SELLERS" | "PRICE";
  title: string;
  subtitle?: string | null;
  enabled: boolean;
  sortOrder: number;
  items: SectionItem[];
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
  const [homeLoading, setHomeLoading] = useState(true);
  const [homeError, setHomeError] = useState<string | null>(null);
  const [homeBanners, setHomeBanners] = useState<Banner[]>([]);
  const [homeSections, setHomeSections] = useState<Section[]>([]);
  const [activeSlide, setActiveSlide] = useState(0);
  const searchParams = useSearchParams();

  useEffect(() => {
    async function loadHomepage() {
      setHomeLoading(true);
      setHomeError(null);
      try {
        const res = await fetch(`${apiBase}/homepage`, { cache: "no-store" });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error((data?.error as string) ?? "Could not load homepage content");
        }
        const banners = ((data?.banners as Banner[]) ?? []).slice(0, 5);
        const sections = ((data?.sections as Section[]) ?? []).filter((section) => section.enabled);
        setHomeBanners(banners);
        setHomeSections(sections);
      } catch (err: any) {
        setHomeError(err?.message ?? "Unable to load homepage content.");
        setHomeBanners([]);
        setHomeSections([]);
      } finally {
        setHomeLoading(false);
      }
    }

    loadHomepage();
  }, []);

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

  const heroSlides = useMemo(() => {
    const enabled = homeBanners
      .filter((banner) => banner.enabled)
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .slice(0, 5);
    if (!enabled.length) return [];
    const slides = [...enabled];
    let idx = 0;
    while (slides.length < 3 && enabled.length > 0) {
      slides.push(enabled[idx % enabled.length]);
      idx += 1;
    }
    return slides.slice(0, 5);
  }, [homeBanners]);

  useEffect(() => {
    setActiveSlide(0);
    if (heroSlides.length <= 1) return;
    const timer = setInterval(() => {
      setActiveSlide((prev) => (prev + 1) % heroSlides.length);
    }, 6000);
    return () => clearInterval(timer);
  }, [heroSlides]);

  const sectionByType = useMemo(() => {
    const bucket: Partial<Record<Section["type"], Section>> = {};
    homeSections
      .slice()
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .forEach((section) => {
        if (!bucket[section.type]) {
          bucket[section.type] = section;
        }
      });
    return bucket;
  }, [homeSections]);

  const categorySection = sectionByType.CATEGORY;
  const needSection = sectionByType.NEED;
  const featuredCollection = sectionByType.FEATURED_COLLECTION;
  const bestSellerSection = sectionByType.BEST_SELLERS;
  const priceSection = sectionByType.PRICE;

  const productLookup = useMemo(() => {
    const map: Record<string, Product> = {};
    productsToShow.forEach((product) => {
      map[product.id] = product;
      if (product.slug) map[product.slug] = product;
      if (product.sku) map[product.sku] = product;
    });
    return map;
  }, [productsToShow]);

  const bestSellerProducts = useMemo(() => {
    if (bestSellerSection?.items?.length) {
      const resolved = bestSellerSection.items
        .map((item) => {
          const target = item.linkTarget?.trim();
          if (target && productLookup[target]) return productLookup[target];
          if (item.label && productLookup[item.label]) return productLookup[item.label];
          return null;
        })
        .filter(Boolean) as Product[];
      if (resolved.length) return resolved.slice(0, 8);
    }
    if (featured.length) return featured.slice(0, 8);
    return productsToShow.slice(0, 8);
  }, [bestSellerSection, productLookup, featured, productsToShow]);

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
    <div className="home-shell">
      <section className="hero-wrapper">
        {homeLoading ? (
          <div className="hero-skeleton">Loading hero...</div>
        ) : heroSlides.length ? (
          <div className="hero-carousel">
            {heroSlides.map((banner, idx) => {
              const bg = normalizeImageUrl(banner.imageUrl);
              return (
                <article
                  key={`${banner.id}-${idx}`}
                  className={`hero-slide ${idx === activeSlide ? "active" : ""}`}
                  style={bg ? { backgroundImage: `linear-gradient(90deg, rgba(19,25,33,0.48), rgba(19,25,33,0.05)), url(${bg})` } : undefined}
                >
                  <div className="hero-content">
                    <div className="hero-eyebrow">Homepage banner</div>
                    <h1>{banner.title}</h1>
                    {banner.subtext && <p className="muted">{banner.subtext}</p>}
                    <div className="hero-actions">
                      {banner.ctaText && (
                        <a className="button" href={banner.ctaLink || "#"}>
                          {banner.ctaText}
                        </a>
                      )}
                      {!banner.ctaText && banner.ctaLink && (
                        <a className="button ghost" href={banner.ctaLink}>
                          View more
                        </a>
                      )}
                    </div>
                  </div>
                  <div className="hero-index">{idx + 1}/{heroSlides.length}</div>
                </article>
              );
            })}
            {heroSlides.length > 1 && (
              <div className="hero-dots">
                {heroSlides.map((_, idx) => (
                  <button
                    key={idx}
                    className={`dot-btn ${idx === activeSlide ? "active" : ""}`}
                    onClick={() => setActiveSlide(idx)}
                    aria-label={`Go to slide ${idx + 1}`}
                    type="button"
                  />
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="card hero-placeholder">
            <div className="hero-eyebrow" style={{ marginBottom: "0.35rem" }}>
              Add homepage banners
            </div>
            <p className="muted">Set up 3–5 banners from the admin dashboard to fill this carousel.</p>
            <a className="button ghost" href="/dashboard/homepage">
              Go to homepage layout
            </a>
          </div>
        )}
      </section>

      <div className="section-stack">
        {homeError && <p className="signin-error">{homeError}</p>}
        {usingFallback && (
          <p className="muted" style={{ marginTop: 0 }}>
            Live products will appear once the catalog is set up. You are seeing sample items for now.
          </p>
        )}
        {loading && <p className="muted">Loading products...</p>}
        {error && <p className="signin-error">{error}</p>}
        {notice && <p className="signin-success">{notice}</p>}

        {categorySection && (
          <section className="module">
            <div className="section-head">
              <div>
                <div className="hero-eyebrow">{categorySection.title}</div>
                {categorySection.subtitle && <p className="muted">{categorySection.subtitle}</p>}
              </div>
            </div>
            <div className="tile-grid">
              {categorySection.items.slice(0, 4).map((item) => {
                const img = normalizeImageUrl(item.imageUrl);
                return (
                  <a key={item.id} className="tile-card" href={item.linkTarget || "#"}>
                    {item.badge && <span className="mini-pill">{item.badge}</span>}
                    <div className="tile-media" style={img ? { backgroundImage: `url(${img})` } : undefined} />
                    <div className="tile-body">
                      <strong>{item.label}</strong>
                      {item.linkTarget && <span className="muted small">{item.linkTarget}</span>}
                    </div>
                  </a>
                );
              })}
            </div>
          </section>
        )}

        {needSection && (
          <section className="module">
            <div className="section-head">
              <div>
                <div className="hero-eyebrow">{needSection.title}</div>
                {needSection.subtitle && <p className="muted">{needSection.subtitle}</p>}
              </div>
            </div>
            <div className="tile-grid">
              {needSection.items.slice(0, 4).map((item) => {
                const img = normalizeImageUrl(item.imageUrl);
                return (
                  <a key={item.id} className="tile-card need" href={item.linkTarget || "#"}>
                    <div className="tile-media" style={img ? { backgroundImage: `url(${img})` } : undefined} />
                    <div className="tile-body">
                      <strong>{item.label}</strong>
                      {item.badge && <span className="muted small">{item.badge}</span>}
                    </div>
                  </a>
                );
              })}
            </div>
          </section>
        )}

        {featuredCollection && featuredCollection.items.length > 0 && (
          <section className="module">
            <div className="section-head">
              <div>
                <div className="hero-eyebrow">{featuredCollection.title}</div>
                {featuredCollection.subtitle && <p className="muted">{featuredCollection.subtitle}</p>}
              </div>
            </div>
            {(() => {
              const item = featuredCollection.items[0];
              const img = normalizeImageUrl(item.imageUrl);
              return (
                <a className="featured-card" href={item.linkTarget || "#"} style={img ? { backgroundImage: `url(${img})` } : undefined}>
                  <div className="featured-overlay">
                    {item.badge && <span className="mini-pill">{item.badge}</span>}
                    <h2>{item.label}</h2>
                    {item.linkTarget && <span className="muted small">{item.linkTarget}</span>}
                  </div>
                </a>
              );
            })()}
          </section>
        )}

        {bestSellerSection && (
          <section className="module">
            <div className="section-head">
              <div>
                <div className="hero-eyebrow">{bestSellerSection.title}</div>
                {bestSellerSection.subtitle && <p className="muted">{bestSellerSection.subtitle}</p>}
              </div>
            </div>
            <div className="catalog-grid">
              {bestSellerProducts.map((product) => {
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
                    <div className="muted small" style={{ marginBottom: "0.35rem", display: "flex", flexDirection: "column", gap: "0.15rem" }}>
                      {stockQty !== null && (
                        <span>
                          Stock: {stockQty} {stockQty === 1 ? "unit" : "units"}
                        </span>
                      )}
                      {lowStock && <span className="stock-flag low">Only {stockQty} left</span>}
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
          </section>
        )}

        {priceSection && (
          <section className="module">
            <div className="section-head">
              <div>
                <div className="hero-eyebrow">{priceSection.title}</div>
                {priceSection.subtitle && <p className="muted">{priceSection.subtitle}</p>}
              </div>
            </div>
            <div className="tile-grid">
              {priceSection.items.slice(0, 4).map((item) => (
                <a key={item.id} className="tile-card price" href={item.linkTarget || "#"}>
                  <div className="tile-body">
                    <strong>{item.label}</strong>
                    {item.badge && <span className="mini-pill">{item.badge}</span>}
                    {item.linkTarget && <span className="muted small">{item.linkTarget}</span>}
                  </div>
                </a>
              ))}
            </div>
          </section>
        )}

        {searchQuery && (
          <section className="module">
            <div className="section-head">
              <div>
                <div className="hero-eyebrow">Search</div>
                <p className="muted small" style={{ margin: 0 }}>
                  {visibleProducts.length
                    ? `${visibleProducts.length} match${visibleProducts.length === 1 ? "" : "es"} found`
                    : "No exact matches. Showing recommendations instead."}
                </p>
              </div>
            </div>
            {visibleProducts.length === 0 && (
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
            )}
            {visibleProducts.length > 0 && (
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
                      <div className="muted small" style={{ marginBottom: "0.35rem", display: "flex", flexDirection: "column", gap: "0.15rem" }}>
                        {stockQty !== null && (
                          <span>
                            Stock: {stockQty} {stockQty === 1 ? "unit" : "units"}
                          </span>
                        )}
                        {lowStock && <span className="stock-flag low">Only {stockQty} left</span>}
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
            )}
          </section>
        )}

        {!homeLoading && !homeSections.length && (
          <div className="card">
            <div className="hero-eyebrow" style={{ marginBottom: "0.25rem" }}>
              Homepage sections
            </div>
            <p className="muted" style={{ margin: 0 }}>
              Add category, need, featured, best seller, or price sections from the admin dashboard to populate this area.
            </p>
          </div>
        )}
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
