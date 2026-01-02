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
  productType?: string | null;
  careAreas?: string[];
  suitableFor?: string[];
  ingredients?: string[];
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
  const [slideDirection, setSlideDirection] = useState<"forward" | "back">("forward");
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({});
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [selectedProductTypes, setSelectedProductTypes] = useState<string[]>([]);
  const [selectedCareAreas, setSelectedCareAreas] = useState<string[]>([]);
  const [selectedSuitableFor, setSelectedSuitableFor] = useState<string[]>([]);
  const [selectedIngredients, setSelectedIngredients] = useState<string[]>([]);
  const [priceMin, setPriceMin] = useState<string>("");
  const [priceMax, setPriceMax] = useState<string>("");
  const [inStockOnly, setInStockOnly] = useState(false);
  const [featuredOnly, setFeaturedOnly] = useState(false);
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);
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
          items.map((item) => {
            const stockQty = Number(item.stockQty ?? 0);
            const normalizedStock = Number.isFinite(stockQty) ? stockQty : undefined;
            return {
              id: item.id,
              slug: item.slug,
              name: item.name,
              description: item.description,
              price: item.price,
              sku: item.sku,
              imageUrl: item.imageUrl,
              category: item.category,
              stockQty: normalizedStock,
              tagline: item.category ?? "New arrival",
              badge: normalizedStock === 0 ? "Out of stock" : item.category ?? undefined,
              featured: item.featured,
              productType: item.productType ?? null,
              careAreas: item.careAreas ?? [],
              suitableFor: item.suitableFor ?? [],
              ingredients: item.ingredients ?? []
            };
          })
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
  useEffect(() => {
    if (!searchParams) return;
    const parseList = (value: string | null) =>
      value ? value.split(",").map((entry) => entry.trim()).filter(Boolean) : [];

    const categories = parseList(searchParams.get("category"));
    const productTypes = parseList(searchParams.get("productType"));
    const careAreas = parseList(searchParams.get("careArea"));
    const suitableFor = parseList(searchParams.get("suitableFor"));
    const ingredients = parseList(searchParams.get("ingredient"));

    setSelectedCategories(categories);
    setSelectedProductTypes(productTypes);
    setSelectedCareAreas(careAreas);
    setSelectedSuitableFor(suitableFor);
    setSelectedIngredients(ingredients);

    const min = searchParams.get("priceMin");
    const max = searchParams.get("priceMax");
    setPriceMin(min ?? "");
    setPriceMax(max ?? "");
    setInStockOnly(searchParams.get("inStock") === "true");
    setFeaturedOnly(searchParams.get("featured") === "true");
  }, [searchParams]);
  const normalizedQuery = searchQuery.toLowerCase();
  useEffect(() => {
    if (!searchQuery) setMobileFiltersOpen(false);
  }, [searchQuery]);
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
  const availableCategories = useMemo(() => {
    const set = new Set<string>();
    productsToShow.forEach((product) => {
      if (product.category) set.add(product.category);
    });
    return Array.from(set).sort();
  }, [productsToShow]);
  const availableProductTypes = useMemo(() => {
    const set = new Set<string>();
    productsToShow.forEach((product) => {
      if (product.productType) set.add(product.productType);
    });
    return Array.from(set).sort();
  }, [productsToShow]);
  const availableCareAreas = useMemo(() => {
    const set = new Set<string>();
    productsToShow.forEach((product) => {
      (product.careAreas ?? []).forEach((area) => set.add(area));
    });
    return Array.from(set).sort();
  }, [productsToShow]);
  const availableSuitableFor = useMemo(() => {
    const set = new Set<string>();
    productsToShow.forEach((product) => {
      (product.suitableFor ?? []).forEach((value) => set.add(value));
    });
    return Array.from(set).sort();
  }, [productsToShow]);
  const availableIngredients = useMemo(() => {
    const set = new Set<string>();
    productsToShow.forEach((product) => {
      (product.ingredients ?? []).forEach((value) => set.add(value));
    });
    return Array.from(set).sort();
  }, [productsToShow]);
  const filteredResults = useMemo(() => {
    let next = filteredProducts;
    if (selectedCategories.length) {
      next = next.filter((product) => product.category && selectedCategories.includes(product.category));
    }
    if (selectedProductTypes.length) {
      next = next.filter((product) => product.productType && selectedProductTypes.includes(product.productType));
    }
    if (selectedCareAreas.length) {
      next = next.filter((product) => product.careAreas?.some((area) => selectedCareAreas.includes(area)));
    }
    if (selectedSuitableFor.length) {
      next = next.filter((product) => product.suitableFor?.some((value) => selectedSuitableFor.includes(value)));
    }
    if (selectedIngredients.length) {
      next = next.filter((product) => product.ingredients?.some((value) => selectedIngredients.includes(value)));
    }
    const min = priceMin ? Number(priceMin) : null;
    const max = priceMax ? Number(priceMax) : null;
    if (Number.isFinite(min ?? NaN)) {
      next = next.filter((product) => product.price >= (min as number));
    }
    if (Number.isFinite(max ?? NaN)) {
      next = next.filter((product) => product.price <= (max as number));
    }
    if (inStockOnly) {
      next = next.filter((product) => (typeof product.stockQty === "number" ? product.stockQty > 0 : true));
    }
    if (featuredOnly) {
      next = next.filter((product) => product.featured);
    }
    return next;
  }, [
    filteredProducts,
    selectedCategories,
    selectedProductTypes,
    selectedCareAreas,
    selectedSuitableFor,
    selectedIngredients,
    priceMin,
    priceMax,
    inStockOnly,
    featuredOnly
  ]);
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
    setSlideDirection("forward");
  }, [heroSlides]);

  useEffect(() => {
    if (heroSlides.length <= 1) return;
    const timer = setInterval(() => {
      setSlideDirection("forward");
      setActiveSlide((prev) => (prev + 1) % heroSlides.length);
    }, 6000);
    return () => clearInterval(timer);
  }, [heroSlides]);

  const sortedSections = useMemo(
    () => homeSections.slice().sort((a, b) => a.sortOrder - b.sortOrder),
    [homeSections]
  );

  const productLookup = useMemo(() => {
    const map: Record<string, Product> = {};
    productsToShow.forEach((product) => {
      map[product.id] = product;
      if (product.slug) map[product.slug] = product;
      if (product.sku) map[product.sku] = product;
    });
    return map;
  }, [productsToShow]);

  function resolveSectionProducts(section: Section) {
    if (section.items?.length) {
      const resolved = section.items
        .map((item) => {
          const target = item.linkTarget?.trim();
          if (target && productLookup[target]) return productLookup[target];
          if (item.label && productLookup[item.label]) return productLookup[item.label];
          return null;
        })
        .filter(Boolean) as Product[];
      if (resolved.length) return resolved;
    }
    if (featured.length) return featured;
    return productsToShow;
  }

  function toggleExpanded(sectionId: string) {
    setExpandedSections((prev) => ({ ...prev, [sectionId]: !prev[sectionId] }));
  }

  function toggleCategory(category: string) {
    setSelectedCategories((prev) => (prev.includes(category) ? prev.filter((item) => item !== category) : [...prev, category]));
  }

  function toggleSelected(list: string[], value: string, setter: (values: string[]) => void) {
    setter(list.includes(value) ? list.filter((item) => item !== value) : [...list, value]);
  }

  function resetFilters() {
    setSelectedCategories([]);
    setSelectedProductTypes([]);
    setSelectedCareAreas([]);
    setSelectedSuitableFor([]);
    setSelectedIngredients([]);
    setPriceMin("");
    setPriceMax("");
    setInStockOnly(false);
    setFeaturedOnly(false);
  }

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

  function humanizeTag(value: string) {
    return value
      .replace(/_/g, " ")
      .replace(/\b\w/g, (char) => char.toUpperCase())
      .trim();
  }

  function buildFilterHref(linkTarget?: string | null) {
    if (!linkTarget) return "#";
    const trimmed = linkTarget.trim();
    if (!trimmed) return "#";
    if (trimmed.startsWith("/") || trimmed.startsWith("http")) return trimmed;
    if (trimmed.startsWith("?")) return `/${trimmed}`;
    return `/?${trimmed}`;
  }

  function resolveItemLink(item: SectionItem) {
    if (item.linkType === "FILTER") {
      return buildFilterHref(item.linkTarget);
    }
    return item.linkTarget || "#";
  }

  function shouldShowItemTarget(item: SectionItem) {
    return Boolean(item.linkTarget && item.linkType !== "FILTER");
  }

  const hasSearchResults =
    Boolean(searchQuery) ||
    selectedCategories.length > 0 ||
    selectedProductTypes.length > 0 ||
    selectedCareAreas.length > 0 ||
    selectedSuitableFor.length > 0 ||
    selectedIngredients.length > 0 ||
    Boolean(priceMin) ||
    Boolean(priceMax) ||
    inStockOnly ||
    featuredOnly;

  return (
    <div className="home-shell">
      {!hasSearchResults && (
        <section className="hero-wrapper">
          {homeLoading ? (
            <div className="hero-skeleton">Loading hero...</div>
          ) : heroSlides.length ? (
            <div className={`hero-carousel ${slideDirection === "back" ? "dir-back" : "dir-forward"}`}>
              {heroSlides.map((banner, idx) => {
                const bg = normalizeImageUrl(banner.imageUrl);
                return (
                  <article
                    key={`${banner.id}-${idx}`}
                    className={`hero-slide ${idx === activeSlide ? "active" : ""}`}
                    style={bg ? { backgroundImage: `url(${bg})` } : undefined}
                  >
                    <div className="hero-content">
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
                      onClick={() => {
                        setSlideDirection(idx > activeSlide ? "forward" : "back");
                        setActiveSlide(idx);
                      }}
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
              <p className="muted">Set up 3-5 banners from the admin dashboard to fill this carousel.</p>
              <a className="button ghost" href="/dashboard/homepage">
                Go to homepage layout
              </a>
            </div>
          )}
        </section>
      )}

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

        {!hasSearchResults &&
          sortedSections.map((section) => {
            const isExpanded = Boolean(expandedSections[section.id]);
            if (section.type === "CATEGORY") {
            const canExpand = section.items.length > 4;
            const items = section.items.slice(0, isExpanded ? section.items.length : 4);
            return (
              <section className="module" key={section.id}>
                <div className="section-head">
                  <div>
                    <div className="hero-eyebrow">{section.title}</div>
                    {section.subtitle && <p className="muted">{section.subtitle}</p>}
                  </div>
                  {canExpand && (
                    <button className="section-action" type="button" onClick={() => toggleExpanded(section.id)}>
                      {isExpanded ? "See less" : "See more"}
                    </button>
                  )}
                </div>
                <div className="tile-grid">
                  {items.map((item) => {
                    const img = normalizeImageUrl(item.imageUrl);
                    return (
                      <a key={item.id} className="tile-card" href={resolveItemLink(item)}>
                        {item.badge && <span className="mini-pill">{item.badge}</span>}
                        <div className="tile-media" style={img ? { backgroundImage: `url(${img})` } : undefined} />
                        <div className="tile-body">
                          <strong>{item.label}</strong>
                          {shouldShowItemTarget(item) && <span className="muted small">{item.linkTarget}</span>}
                        </div>
                      </a>
                    );
                  })}
                </div>
              </section>
            );
          }

          if (section.type === "NEED") {
            const canExpand = section.items.length > 4;
            const items = section.items.slice(0, isExpanded ? section.items.length : 4);
            return (
              <section className="module" key={section.id}>
                <div className="section-head">
                  <div>
                    <div className="hero-eyebrow">{section.title}</div>
                    {section.subtitle && <p className="muted">{section.subtitle}</p>}
                  </div>
                  {canExpand && (
                    <button className="section-action" type="button" onClick={() => toggleExpanded(section.id)}>
                      {isExpanded ? "See less" : "See more"}
                    </button>
                  )}
                </div>
                <div className="tile-grid">
                  {items.map((item) => {
                    const img = normalizeImageUrl(item.imageUrl);
                    return (
                      <a key={item.id} className="tile-card need" href={resolveItemLink(item)}>
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
            );
          }

          if (section.type === "FEATURED_COLLECTION" && section.items.length > 0) {
            const item = section.items[0];
            const img = normalizeImageUrl(item.imageUrl);
            return (
              <section className="module" key={section.id}>
                <div className="section-head">
                  <div>
                    <div className="hero-eyebrow">{section.title}</div>
                    {section.subtitle && <p className="muted">{section.subtitle}</p>}
                  </div>
                </div>
                <a className="featured-card" href={resolveItemLink(item)} style={img ? { backgroundImage: `url(${img})` } : undefined}>
                  <div className="featured-overlay">
                    {item.badge && <span className="mini-pill">{item.badge}</span>}
                    <h2>{item.label}</h2>
                    {shouldShowItemTarget(item) && <span className="muted small">{item.linkTarget}</span>}
                  </div>
                </a>
              </section>
            );
          }

          if (section.type === "BEST_SELLERS") {
            const resolved = resolveSectionProducts(section);
            const canExpand = resolved.length > 4;
            const products = resolved.slice(0, isExpanded ? resolved.length : 4);
            return (
              <section className="module" key={section.id}>
                <div className="section-head">
                  <div>
                    <div className="hero-eyebrow">{section.title}</div>
                    {section.subtitle && <p className="muted">{section.subtitle}</p>}
                  </div>
                  {canExpand && (
                    <button className="section-action" type="button" onClick={() => toggleExpanded(section.id)}>
                      {isExpanded ? "See less" : "See more"}
                    </button>
                  )}
                </div>
                <div className="catalog-grid">
                  {products.map((product) => {
                    const img = normalizeImageUrl(product.imageUrl);
                    const stockQty = typeof product.stockQty === "number" ? product.stockQty : null;
                    const lowStock = stockQty !== null && stockQty > 0 && stockQty <= 10;
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
                          style={
                            img
                              ? { backgroundImage: `url(${img})`, backgroundSize: "contain", backgroundRepeat: "no-repeat", backgroundPosition: "center" }
                              : undefined
                          }
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
            );
          }

          if (section.type === "PRICE") {
            const canExpand = section.items.length > 4;
            const items = section.items.slice(0, isExpanded ? section.items.length : 4);
            return (
              <section className="module" key={section.id}>
                <div className="section-head">
                  <div>
                    <div className="hero-eyebrow">{section.title}</div>
                    {section.subtitle && <p className="muted">{section.subtitle}</p>}
                  </div>
                  {canExpand && (
                    <button className="section-action" type="button" onClick={() => toggleExpanded(section.id)}>
                      {isExpanded ? "See less" : "See more"}
                    </button>
                  )}
                </div>
                <div className="tile-grid">
                  {items.map((item) => (
                    <a key={item.id} className="tile-card price" href={resolveItemLink(item)}>
                      <div className="tile-body">
                        <strong>{item.label}</strong>
                        {item.badge && <span className="mini-pill">{item.badge}</span>}
                        {shouldShowItemTarget(item) && <span className="muted small">{item.linkTarget}</span>}
                      </div>
                    </a>
                  ))}
                </div>
              </section>
            );
          }

          return null;
          })}

        {hasSearchResults && (
          <>
            <div className="filter-chip-bar" aria-label="Quick filters">
              <button
                className="filter-chip"
                type="button"
                onClick={() => setMobileFiltersOpen(true)}
              >
                Filters
              </button>
              {availableCategories.map((category) => (
                <button
                  key={category}
                  className={`filter-chip ${selectedCategories.includes(category) ? "active" : ""}`}
                  type="button"
                  onClick={() => toggleCategory(category)}
                >
                  {category}
                </button>
              ))}
              <button
                className={`filter-chip ${priceMin === "" && priceMax === "500" ? "active" : ""}`}
                type="button"
                onClick={() => {
                  setPriceMin("");
                  setPriceMax("500");
                }}
              >
                Under 500
              </button>
              <button
                className={`filter-chip ${priceMin === "500" && priceMax === "1500" ? "active" : ""}`}
                type="button"
                onClick={() => {
                  setPriceMin("500");
                  setPriceMax("1500");
                }}
              >
                500 - 1,500
              </button>
              <button
                className={`filter-chip ${priceMin === "1500" && priceMax === "" ? "active" : ""}`}
                type="button"
                onClick={() => {
                  setPriceMin("1500");
                  setPriceMax("");
                }}
              >
                1,500+
              </button>
              <button
                className={`filter-chip ${inStockOnly ? "active" : ""}`}
                type="button"
                onClick={() => setInStockOnly((prev) => !prev)}
              >
                In stock
              </button>
              <button
                className={`filter-chip ${featuredOnly ? "active" : ""}`}
                type="button"
                onClick={() => setFeaturedOnly((prev) => !prev)}
              >
                Featured
              </button>
            </div>
            <div className={`filter-overlay ${mobileFiltersOpen ? "open" : ""}`} onClick={() => setMobileFiltersOpen(false)} />
            <aside
              className={`filter-panel ${mobileFiltersOpen ? "open" : ""}`}
              aria-hidden={!mobileFiltersOpen}
              aria-label="Filters"
              role="dialog"
            >
              <div className="filter-panel-head">
                <strong>Filters</strong>
                <button className="nav-link-button" type="button" onClick={() => setMobileFiltersOpen(false)}>
                  Close
                </button>
              </div>
              <div className="filter-panel-body">
                <div className="filter-block">
                  <div className="filter-title">Categories</div>
                  {availableCategories.length === 0 && <p className="muted small">No categories yet.</p>}
                  {availableCategories.map((category) => (
                    <label key={category} className="filter-item">
                      <input
                        type="checkbox"
                        checked={selectedCategories.includes(category)}
                        onChange={() => toggleCategory(category)}
                      />
                      <span>{category}</span>
                    </label>
                  ))}
                </div>
                <div className="filter-block">
                  <div className="filter-title">Product type</div>
                  {availableProductTypes.length === 0 && <p className="muted small">No product types yet.</p>}
                  {availableProductTypes.map((value) => (
                    <label key={value} className="filter-item">
                      <input
                        type="checkbox"
                        checked={selectedProductTypes.includes(value)}
                        onChange={() => toggleSelected(selectedProductTypes, value, setSelectedProductTypes)}
                      />
                      <span>{humanizeTag(value)}</span>
                    </label>
                  ))}
                </div>
                <div className="filter-block">
                  <div className="filter-title">Care area</div>
                  {availableCareAreas.length === 0 && <p className="muted small">No care areas yet.</p>}
                  {availableCareAreas.map((value) => (
                    <label key={value} className="filter-item">
                      <input
                        type="checkbox"
                        checked={selectedCareAreas.includes(value)}
                        onChange={() => toggleSelected(selectedCareAreas, value, setSelectedCareAreas)}
                      />
                      <span>{humanizeTag(value)}</span>
                    </label>
                  ))}
                </div>
                <div className="filter-block">
                  <div className="filter-title">Suitable for</div>
                  {availableSuitableFor.length === 0 && <p className="muted small">No suitability tags yet.</p>}
                  {availableSuitableFor.map((value) => (
                    <label key={value} className="filter-item">
                      <input
                        type="checkbox"
                        checked={selectedSuitableFor.includes(value)}
                        onChange={() => toggleSelected(selectedSuitableFor, value, setSelectedSuitableFor)}
                      />
                      <span>{humanizeTag(value)}</span>
                    </label>
                  ))}
                </div>
                <div className="filter-block">
                  <div className="filter-title">Ingredients</div>
                  {availableIngredients.length === 0 && <p className="muted small">No ingredient tags yet.</p>}
                  {availableIngredients.map((value) => (
                    <label key={value} className="filter-item">
                      <input
                        type="checkbox"
                        checked={selectedIngredients.includes(value)}
                        onChange={() => toggleSelected(selectedIngredients, value, setSelectedIngredients)}
                      />
                      <span>{humanizeTag(value)}</span>
                    </label>
                  ))}
                </div>
                <div className="filter-block">
                  <div className="filter-title">Price (KES)</div>
                  <div className="filter-row">
                    <input
                      className="filter-input"
                      type="number"
                      min={0}
                      placeholder="Min"
                      value={priceMin}
                      onChange={(e) => setPriceMin(e.target.value)}
                    />
                    <input
                      className="filter-input"
                      type="number"
                      min={0}
                      placeholder="Max"
                      value={priceMax}
                      onChange={(e) => setPriceMax(e.target.value)}
                    />
                  </div>
                  <div className="filter-quick">
                    <button type="button" onClick={() => { setPriceMin(""); setPriceMax("500"); }}>
                      Under 500
                    </button>
                    <button type="button" onClick={() => { setPriceMin("500"); setPriceMax("1500"); }}>
                      500 - 1,500
                    </button>
                    <button type="button" onClick={() => { setPriceMin("1500"); setPriceMax(""); }}>
                      1,500+
                    </button>
                  </div>
                </div>
                <div className="filter-block">
                  <div className="filter-title">Availability</div>
                  <label className="filter-item">
                    <input type="checkbox" checked={inStockOnly} onChange={(e) => setInStockOnly(e.target.checked)} />
                    <span>In stock only</span>
                  </label>
                  <label className="filter-item">
                    <input type="checkbox" checked={featuredOnly} onChange={(e) => setFeaturedOnly(e.target.checked)} />
                    <span>Featured picks</span>
                  </label>
                </div>
              </div>
              <div className="filter-panel-actions">
                <button className="button ghost full" type="button" onClick={resetFilters}>
                  Clear filters
                </button>
                <button className="button full" type="button" onClick={() => setMobileFiltersOpen(false)}>
                  View results
                </button>
              </div>
            </aside>
            <section className="module search-module">
              <div className="section-head">
                <div>
                  <div className="hero-eyebrow">Search results</div>
                  <p className="muted small" style={{ margin: 0 }}>
                    {filteredResults.length
                      ? `${filteredResults.length} match${filteredResults.length === 1 ? "" : "es"} found`
                      : "No exact matches with the current filters."}
                  </p>
                </div>
                <button className="section-action" type="button" onClick={resetFilters}>
                  Clear filters
                </button>
              </div>
              <div className="search-layout">
                <aside className="search-filters">
                <div className="filter-block">
                  <div className="filter-title">Categories</div>
                  {availableCategories.length === 0 && <p className="muted small">No categories yet.</p>}
                  {availableCategories.map((category) => (
                    <label key={category} className="filter-item">
                      <input
                        type="checkbox"
                        checked={selectedCategories.includes(category)}
                        onChange={() => toggleCategory(category)}
                      />
                      <span>{category}</span>
                    </label>
                  ))}
                </div>
                <div className="filter-block">
                  <div className="filter-title">Product type</div>
                  {availableProductTypes.length === 0 && <p className="muted small">No product types yet.</p>}
                  {availableProductTypes.map((value) => (
                    <label key={value} className="filter-item">
                      <input
                        type="checkbox"
                        checked={selectedProductTypes.includes(value)}
                        onChange={() => toggleSelected(selectedProductTypes, value, setSelectedProductTypes)}
                      />
                      <span>{humanizeTag(value)}</span>
                    </label>
                  ))}
                </div>
                <div className="filter-block">
                  <div className="filter-title">Care area</div>
                  {availableCareAreas.length === 0 && <p className="muted small">No care areas yet.</p>}
                  {availableCareAreas.map((value) => (
                    <label key={value} className="filter-item">
                      <input
                        type="checkbox"
                        checked={selectedCareAreas.includes(value)}
                        onChange={() => toggleSelected(selectedCareAreas, value, setSelectedCareAreas)}
                      />
                      <span>{humanizeTag(value)}</span>
                    </label>
                  ))}
                </div>
                <div className="filter-block">
                  <div className="filter-title">Suitable for</div>
                  {availableSuitableFor.length === 0 && <p className="muted small">No suitability tags yet.</p>}
                  {availableSuitableFor.map((value) => (
                    <label key={value} className="filter-item">
                      <input
                        type="checkbox"
                        checked={selectedSuitableFor.includes(value)}
                        onChange={() => toggleSelected(selectedSuitableFor, value, setSelectedSuitableFor)}
                      />
                      <span>{humanizeTag(value)}</span>
                    </label>
                  ))}
                </div>
                <div className="filter-block">
                  <div className="filter-title">Ingredients</div>
                  {availableIngredients.length === 0 && <p className="muted small">No ingredient tags yet.</p>}
                  {availableIngredients.map((value) => (
                    <label key={value} className="filter-item">
                      <input
                        type="checkbox"
                        checked={selectedIngredients.includes(value)}
                        onChange={() => toggleSelected(selectedIngredients, value, setSelectedIngredients)}
                      />
                      <span>{humanizeTag(value)}</span>
                    </label>
                  ))}
                </div>
                <div className="filter-block">
                  <div className="filter-title">Price (KES)</div>
                  <div className="filter-row">
                    <input
                      className="filter-input"
                      type="number"
                      min={0}
                      placeholder="Min"
                      value={priceMin}
                      onChange={(e) => setPriceMin(e.target.value)}
                    />
                    <input
                      className="filter-input"
                      type="number"
                      min={0}
                      placeholder="Max"
                      value={priceMax}
                      onChange={(e) => setPriceMax(e.target.value)}
                    />
                  </div>
                  <div className="filter-quick">
                    <button type="button" onClick={() => { setPriceMin(""); setPriceMax("500"); }}>
                      Under 500
                    </button>
                    <button type="button" onClick={() => { setPriceMin("500"); setPriceMax("1500"); }}>
                      500 - 1,500
                    </button>
                    <button type="button" onClick={() => { setPriceMin("1500"); setPriceMax(""); }}>
                      1,500+
                    </button>
                  </div>
                </div>
                <div className="filter-block">
                  <div className="filter-title">Availability</div>
                  <label className="filter-item">
                    <input type="checkbox" checked={inStockOnly} onChange={(e) => setInStockOnly(e.target.checked)} />
                    <span>In stock only</span>
                  </label>
                  <label className="filter-item">
                    <input type="checkbox" checked={featuredOnly} onChange={(e) => setFeaturedOnly(e.target.checked)} />
                    <span>Featured picks</span>
                  </label>
                </div>
              </aside>
              <div className="search-results">
                {filteredResults.length === 0 && (
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
                          <div
                            className="product-thumb"
                            style={
                              img
                                ? { backgroundImage: `url(${img})`, backgroundSize: "contain", backgroundRepeat: "no-repeat", backgroundPosition: "center" }
                                : undefined
                            }
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
                {filteredResults.length > 0 && (
                  <div className="catalog-grid">
                    {filteredResults.map((product) => {
                      const img = normalizeImageUrl(product.imageUrl);
                      const stockQty = typeof product.stockQty === "number" ? product.stockQty : null;
                      const lowStock = stockQty !== null && stockQty > 0 && stockQty <= 10;
                      const outOfStock = stockQty === 0;
                      return (
                        <a
                          className="product-card"
                          key={product.id}
                          href={`/products/${product.slug ?? product.id}`}
                          style={{ textDecoration: "none", color: "inherit" }}
                        >
                          <div
                            className="product-thumb"
                            style={
                              img
                                ? { backgroundImage: `url(${img})`, backgroundSize: "contain", backgroundRepeat: "no-repeat", backgroundPosition: "center" }
                                : undefined
                            }
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
              </div>
              </div>
            </section>
          </>
        )}

        {!hasSearchResults && !homeLoading && !homeSections.length && (
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

      {!hasSearchResults && (
        <footer className="site-footer">
          <div className="footer-grid">
            <div>
              <div className="footer-title">Mwalimu Cosmetics</div>
              <p className="muted small">
                Premium beauty essentials from Kenya. Shop daily care, signature scents, and curated skincare rituals.
              </p>
              <div className="footer-social">
                <a href="https://instagram.com" aria-label="Instagram">
                  Instagram
                </a>
                <a href="https://facebook.com" aria-label="Facebook">
                  Facebook
                </a>
                <a href="https://tiktok.com" aria-label="TikTok">
                  TikTok
                </a>
              </div>
            </div>
            <div>
              <div className="footer-title">Customer care</div>
              <a href="/contact">Contact</a>
              <a href="/policies/shipping">Shipping policy</a>
              <a href="/policies/returns">Returns</a>
              <a href="/policies/privacy">Privacy policy</a>
            </div>
            <div>
              <div className="footer-title">About</div>
              <a href="/about">Our story</a>
              <a href="/locations">Store locations</a>
              <a href="/wholesale">Wholesale</a>
              <a href="/careers">Careers</a>
            </div>
            <div>
              <div className="footer-title">Visit us</div>
              <p className="muted small">Nairobi, Kenya</p>
              <p className="muted small">Open daily: 9:00 AM - 7:00 PM</p>
              <a href="mailto:hello@mwalimucosmetics.com">hello@mwalimucosmetics.com</a>
              <a href="tel:+254700000000">+254 700 000 000</a>
            </div>
          </div>
          <div className="footer-bottom">
            <span>© {new Date().getFullYear()} Mwalimu Cosmetics. All rights reserved.</span>
            <div className="footer-links">
              <a href="/policies/terms">Terms</a>
              <a href="/policies/privacy">Privacy</a>
              <a href="/policies/cookies">Cookies</a>
            </div>
          </div>
        </footer>
      )}
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
