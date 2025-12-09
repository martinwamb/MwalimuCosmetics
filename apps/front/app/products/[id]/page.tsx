"use client";

import { useEffect, useState } from "react";

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
  }, [params.id]);

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

  if (loading) return <p className="muted">Loading product...</p>;
  if (error) return <p className="signin-error">{error}</p>;
  if (!product) return <p className="muted">Product not found.</p>;

  const img = normalizeImageUrl(product.imageUrl);

  return (
    <div className="card" style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr", gap: "1.5rem" }}>
      <div>
        <div
          className="product-thumb"
          style={img ? { height: "320px", backgroundImage: `url(${img})`, backgroundSize: "cover", backgroundPosition: "center" } : { height: "320px" }}
        >
          {!img && <span className="muted">No image</span>}
        </div>
        <h1 style={{ margin: "1rem 0 0.3rem" }}>{product.name}</h1>
        <p className="muted">{product.description ?? "No description provided."}</p>
        <p className="price">{formatKES(product.price)}</p>
        <p className="muted small">
          {product.category ? `Category: ${product.category}` : "Uncategorized"} • Stock: {product.stockQty ?? 0}
        </p>
      </div>

      <div>
        <div className="hero-eyebrow" style={{ marginBottom: "0.35rem" }}>
          Variants
        </div>
        {product.variants.length === 0 && <p className="muted">No variants for this product.</p>}
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
      </div>
    </div>
  );
}
