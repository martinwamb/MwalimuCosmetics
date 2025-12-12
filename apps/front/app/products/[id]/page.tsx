"use client";

import { useEffect, useMemo, useState } from "react";

type Variant = {
  id: string;
  name: string;
  imageUrl?: string | null;
  price?: number | null;
};

type Product = {
  id: string;
  name: string;
  description?: string | null;
  price: number;
  sku?: string | null;
  imageUrl?: string | null;
  category?: string | null;
  stockQty?: number;
  variants: Variant[];
};

const apiBase = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export default function ProductDetailPage({ params }: { params: { id: string } }) {
  const [product, setProduct] = useState<Product | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedVariantId, setSelectedVariantId] = useState<string | null>(null);
  const [activeImage, setActiveImage] = useState<string | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [notice, setNotice] = useState<string | null>(null);
  const [cart, setCart] = useState<{ id: string; name: string; price: number; qty: number }[]>([]);

  useEffect(() => {
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`${apiBase}/products/${params.id}`, { cache: "no-store" });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error((data?.error as string) ?? "Not found");
        const p = data?.data;
        setProduct({
          id: p.id,
          name: p.name,
          description: p.description,
          price: Number(p.price),
          sku: p.sku,
          imageUrl: p.imageUrl,
          category: p.category,
          stockQty: p.stockQty,
          variants:
            (p.variants as Variant[] | undefined)?.map((v) => ({
              id: v.id,
              name: v.name,
              imageUrl: v.imageUrl,
              price: v.price ? Number(v.price) : null
            })) ?? []
        });
      } catch (err: any) {
        setError(err?.message ?? "Unable to load product.");
      } finally {
        setLoading(false);
      }
    }
    load();

    try {
      const storedCart = localStorage.getItem("mwalimu_cart");
      if (storedCart) setCart(JSON.parse(storedCart));
    } catch {
      // ignore cart hydration errors
    }
  }, [params.id]);

  useEffect(() => {
    if (product?.variants?.length) {
      setSelectedVariantId(product.variants[0].id);
    } else {
      setSelectedVariantId(null);
    }
  }, [product?.id, product?.variants]);

  function formatKES(value: number) {
    return new Intl.NumberFormat("en-KE", { style: "currency", currency: "KES", maximumFractionDigits: 2 }).format(value);
  }

  function normalizeImageUrl(url?: string | null) {
    if (!url) return null;
    const trimmed = url.trim();
    if (!trimmed) return null;
    if (trimmed.startsWith("data:")) return trimmed;
    if (trimmed.startsWith("//")) return `https:${trimmed}`;
    if (trimmed.startsWith("/")) return `${apiBase.replace(/\/$/, "")}${trimmed}`;
    if (trimmed.startsWith("http://api.mwalimucosmetics.com")) {
      return trimmed.replace("http://", "https://");
    }
    return trimmed;
  }

  const primaryImage = useMemo(() => {
    if (!product) return null;
    return normalizeImageUrl(product.variants.find((v) => v.id === selectedVariantId)?.imageUrl ?? product.imageUrl);
  }, [product, selectedVariantId]);
  const galleryImages = useMemo(
    () =>
      product
        ? Array.from(
            new Set(
              [product.imageUrl, ...product.variants.map((v) => v.imageUrl)]
                .map((url) => normalizeImageUrl(url))
                .filter(Boolean) as string[]
            )
          )
        : [],
    [product]
  );

  useEffect(() => {
    setActiveImage(primaryImage ?? galleryImages[0] ?? null);
  }, [primaryImage, galleryImages, product?.id]);

  const activeVariant = useMemo(
    () => product?.variants.find((v) => v.id === selectedVariantId) ?? null,
    [product, selectedVariantId]
  );
  const displayPrice = activeVariant?.price ?? product?.price ?? 0;

  function persistCart(next: typeof cart) {
    try {
      localStorage.setItem("mwalimu_cart", JSON.stringify(next));
    } catch {
      // ignore
    }
  }

  function handleAddToCart(message?: string) {
    if (!product) return;
    const next = [...cart];
    const existing = next.findIndex((item) => item.id === product.id && item.price === displayPrice);
    if (existing >= 0) {
      next[existing].qty += quantity;
    } else {
      next.push({ id: product.id, name: product.name, price: displayPrice, qty: quantity });
    }
    setCart(next);
    persistCart(next);
    setNotice(message ?? `Added ${quantity} x ${product.name} to cart.`);
    setTimeout(() => setNotice(null), 1800);
  }

  function handleBuyNow() {
    handleAddToCart("Buy Now is coming soon. Added to cart so you can check out.");
  }

  if (loading) return <p className="muted">Loading product...</p>;
  if (error) return <p className="signin-error">{error}</p>;
  if (!product) return <p className="muted">Product not found.</p>;

  return (
    <div>
      {notice && <p className="signin-success">{notice}</p>}

      <div className="product-page">
        <section className="card product-gallery">
          <div className="thumb-rail">
            {galleryImages.map((src) => (
              <button
                key={src}
                className={`thumb ${activeImage === src ? "active" : ""}`}
                type="button"
                onClick={() => setActiveImage(src)}
                aria-label="Change product image"
                style={{ backgroundImage: `url(${src})` }}
              />
            ))}
          </div>
          <div
            className="main-image"
            style={
              activeImage
                ? { backgroundImage: `url(${activeImage})`, backgroundSize: "contain", backgroundRepeat: "no-repeat", backgroundPosition: "center" }
                : undefined
            }
          >
            {!activeImage && <span className="muted">Image coming soon</span>}
          </div>
        </section>

        <section className="card product-main">
          <div className="hero-eyebrow small">{product.category ?? "General"}</div>
          <h1 style={{ margin: "0 0 0.35rem" }}>{product.name}</h1>
          <div className="rating" style={{ marginBottom: "0.4rem" }}>
            <span>4.6 / 5</span>
            <span className="muted small">Top pick for Mwalimu shoppers</span>
          </div>
          <p className="muted" style={{ marginTop: 0 }}>
            {product.description ?? "No description provided yet. Check back soon for full product details."}
          </p>
          <div className="price-row">
            <span className="price">{formatKES(displayPrice)}</span>
            <span className="delivery">{(product.stockQty ?? 0) > 0 ? "In stock" : "Currently restocking"}</span>
          </div>
          <ul className="detail-list">
            <li>{product.category ? `Category: ${product.category}` : "Uncategorized item"}</li>
            <li>SKU: {product.sku ?? product.id}</li>
            <li>{product.stockQty ? `${product.stockQty} units available` : "Limited availability"}</li>
          </ul>

          {product.variants.length > 0 && (
            <div className="variant-grid">
              {product.variants.map((v) => {
                const selected = v.id === selectedVariantId;
                return (
                  <button
                    key={v.id}
                    className={`variant-chip ${selected ? "active" : ""}`}
                    type="button"
                    onClick={() => {
                      setSelectedVariantId(v.id);
                      if (v.imageUrl) {
                        const normalized = normalizeImageUrl(v.imageUrl);
                        if (normalized) setActiveImage(normalized);
                      }
                    }}
                  >
                    <span>{v.name}</span>
                    <span className="muted small">{v.price ? formatKES(v.price) : "Same price"}</span>
                  </button>
                );
              })}
            </div>
          )}
        </section>

        <aside className="card buy-card">
          <div className="price" style={{ marginBottom: "0.35rem" }}>
            {formatKES(displayPrice)}
          </div>
          <p className="muted small" style={{ marginTop: 0 }}>
            Ships within 24 hours. Delivery options calculated at checkout.
          </p>
          <div className="qty-row">
            <label className="muted small" htmlFor="quantity">
              Quantity
            </label>
            <select
              id="quantity"
              value={quantity}
              onChange={(e) => setQuantity(Number(e.target.value))}
            >
              {[1, 2, 3, 4, 5].map((q) => (
                <option key={q} value={q}>
                  {q}
                </option>
              ))}
            </select>
          </div>
          <button
            className="button full"
            type="button"
            onClick={() => handleAddToCart()}
          >
            Add to Cart
          </button>
          <button
            className="button ghost full"
            type="button"
            onClick={() => handleBuyNow()}
          >
            Buy Now
          </button>
          <p className="muted small" style={{ margin: "0.6rem 0 0" }}>
            Secure checkout - Easy returns - Support via WhatsApp
          </p>
        </aside>
      </div>

      <div className="card" style={{ marginTop: "1rem" }}>
        <div className="hero-eyebrow" style={{ marginBottom: "0.35rem" }}>
          Variants & bundles
        </div>
        {product.variants.length === 0 && <p className="muted">No variants for this product.</p>}
        {product.variants.length > 0 && (
          <div className="catalog-grid">
            {product.variants.map((v) => {
              const vImg = normalizeImageUrl(v.imageUrl);
              return (
                <article key={v.id} className="product-card">
                  {vImg && (
                    <div
                      className="product-thumb"
                      style={{ backgroundImage: `url(${vImg})`, backgroundSize: "cover", backgroundPosition: "center" }}
                    />
                  )}
                  <h3 style={{ margin: "0.25rem 0 0" }}>{v.name}</h3>
                  <p className="price">{v.price ? formatKES(v.price) : "Same price"}</p>
                </article>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
