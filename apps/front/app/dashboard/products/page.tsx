"use client";

import { useCallback, useEffect, useState } from "react";

type Product = {
  id: string;
  name: string;
  sku: string;
  category: string | null;
  price: number;
  cost: number;
  stockQty: number;
  imageUrl?: string | null;
  description?: string | null;
};

const apiBase = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export default function ProductDashboardPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: "",
    sku: "",
    category: "General",
    price: "",
    cost: "",
    stockQty: "0",
    imageUrl: "",
    description: ""
  });

  const loadProducts = useCallback(async (authToken?: string | null) => {
    setFetching(true);
    setError(null);
    try {
      const headers: Record<string, string> = {};
      if (authToken) {
        headers.Authorization = `Bearer ${authToken}`;
      }
      const res = await fetch(`${apiBase}/products?status=ACTIVE&take=100`, { cache: "no-store", headers });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error((data?.error as string) ?? "Could not load products");
      }
      const mapped = ((data?.data as any[]) ?? []).map((item) => {
        const price = Number(item.price);
        const cost = Number(item.cost);
        const stockQty = Number(item.stockQty ?? 0);
        return {
          id: item.id,
          name: item.name,
          sku: item.sku,
          category: item.category ?? null,
          price: Number.isFinite(price) ? price : 0,
          cost: Number.isFinite(cost) ? cost : 0,
          stockQty: Number.isFinite(stockQty) ? stockQty : 0,
          imageUrl: item.imageUrl,
          description: item.description
        };
      });
      setProducts(mapped);
    } catch (err: any) {
      setError(err?.message ?? "Could not load products");
    } finally {
      setFetching(false);
    }
  }, []);

  useEffect(() => {
    const savedToken = typeof window !== "undefined" ? localStorage.getItem("mwalimu_token") : null;
    setToken(savedToken);
    loadProducts(savedToken);
  }, [loadProducts]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setStatus(null);

    if (!token) {
      setError("Sign in as an admin to add products.");
      return;
    }

    const price = parseFloat(form.price);
    const cost = parseFloat(form.cost);
    const stockQty = parseInt(form.stockQty || "0", 10);

    if (Number.isNaN(price) || Number.isNaN(cost)) {
      setError("Enter valid numbers for price and cost.");
      return;
    }
    if (price <= 0) {
      setError("Price must be greater than zero.");
      return;
    }
    if (Number.isNaN(stockQty) || stockQty < 0) {
      setError("Stock quantity must be zero or more.");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch(`${apiBase}/products`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          name: form.name.trim(),
          sku: form.sku.trim(),
          category: form.category.trim() || "General",
          price,
          cost,
          stockQty,
          imageUrl: form.imageUrl.trim() || undefined,
          description: form.description.trim() || undefined
        })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error((data?.error as string) ?? "Could not create product");
      }

      setStatus("Product added to catalog.");
      setForm({
        name: "",
        sku: "",
        category: "General",
        price: "",
        cost: "",
        stockQty: "0",
        imageUrl: "",
        description: ""
      });
      await loadProducts(token);
    } catch (err: any) {
      setError(err?.message ?? "Could not create product");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="grid" style={{ gridTemplateColumns: "minmax(320px, 420px) 1fr", gap: "1.5rem" }}>
      <section className="card">
        <div className="hero-eyebrow" style={{ marginBottom: "0.35rem" }}>
          Catalog management
        </div>
        <h1 style={{ margin: 0 }}>Add a product</h1>
        <p className="muted" style={{ marginTop: "0.35rem" }}>
          Provide the selling price, cost, imagery, and category. Only admins can add or update products.
        </p>

        <form className="signin-form" onSubmit={handleSubmit} style={{ marginTop: "1rem" }}>
          <div className="input-row">
            <label className="input-group" style={{ flex: 2 }}>
              <span>Name</span>
              <input
                value={form.name}
                onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
                placeholder="Vitamin C Serum"
                required
              />
            </label>
            <label className="input-group">
              <span>SKU</span>
              <input
                value={form.sku}
                onChange={(e) => setForm((prev) => ({ ...prev, sku: e.target.value }))}
                placeholder="SKU-001"
                required
              />
            </label>
          </div>

          <div className="input-row">
            <label className="input-group">
              <span>Category</span>
              <input
                value={form.category}
                onChange={(e) => setForm((prev) => ({ ...prev, category: e.target.value }))}
                placeholder="Serums"
              />
            </label>
            <label className="input-group">
              <span>Price (USD)</span>
              <input
                type="number"
                step="0.01"
                min="0"
                value={form.price}
                onChange={(e) => setForm((prev) => ({ ...prev, price: e.target.value }))}
                placeholder="25.00"
                required
              />
            </label>
            <label className="input-group">
              <span>Cost (USD)</span>
              <input
                type="number"
                step="0.01"
                min="0"
                value={form.cost}
                onChange={(e) => setForm((prev) => ({ ...prev, cost: e.target.value }))}
                placeholder="12.00"
                required
              />
            </label>
            <label className="input-group">
              <span>Stock</span>
              <input
                type="number"
                min="0"
                value={form.stockQty}
                onChange={(e) => setForm((prev) => ({ ...prev, stockQty: e.target.value }))}
                placeholder="100"
              />
            </label>
          </div>

          <label className="input-group">
            <span>Image URL</span>
            <input
              value={form.imageUrl}
              onChange={(e) => setForm((prev) => ({ ...prev, imageUrl: e.target.value }))}
              placeholder="https://..."
            />
          </label>

          <label className="input-group">
            <span>Description</span>
            <textarea
              value={form.description}
              onChange={(e) => setForm((prev) => ({ ...prev, description: e.target.value }))}
              placeholder="What makes this product great?"
              rows={3}
            />
          </label>

          <button className="button" type="submit" disabled={loading}>
            {loading ? "Saving..." : "Add product"}
          </button>
        </form>

        {error && <div className="signin-error">{error}</div>}
        {status && <div className="signin-success">{status}</div>}
        {!token && (
          <p className="muted small" style={{ marginTop: "0.35rem" }}>
            Sign in as an admin to submit. Viewing the catalog list is open.
          </p>
        )}
      </section>

      <section>
        <div className="hero-eyebrow" style={{ marginBottom: "0.35rem" }}>
          Catalog
        </div>
        <h2 style={{ margin: 0 }}>Existing products</h2>
        <p className="muted" style={{ marginTop: "0.25rem" }}>
          {fetching ? "Loading..." : `${products.length} products`}
        </p>
        {!fetching && products.length === 0 && <p className="muted">No products yet. Add your first item above.</p>}
        <div className="catalog-grid">
          {products.map((product) => (
            <article key={product.id} className="product-card">
              <div className="badge">{product.category ?? "Uncategorized"}</div>
              <div
                className="product-thumb"
                style={
                  product.imageUrl
                    ? { backgroundImage: `url(${product.imageUrl})`, backgroundSize: "cover", backgroundPosition: "center" }
                    : undefined
                }
              >
                {!product.imageUrl && (product.sku ?? "SKU")}
              </div>
              <h3 style={{ margin: "0.25rem 0 0" }}>{product.name}</h3>
              <p className="muted" style={{ margin: 0 }}>
                {product.description ?? "No description yet."}
              </p>
              <p className="price">
                USD <span style={{ fontSize: "1.1rem" }}>{product.price.toFixed(2)}</span>
              </p>
              <p className="muted small" style={{ margin: 0 }}>
                Cost: {product.cost.toFixed(2)} • Stock: {product.stockQty}
              </p>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
