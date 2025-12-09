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
  variants?: { id: string; name: string; price?: number | null; imageUrl?: string | null }[];
};

const apiBase = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export default function ProductDashboardPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: "",
    sku: "",
    category: "General",
    price: "",
    cost: "",
    stockQty: "0",
    imageUrl: "",
    description: "",
    imageFile: null as File | null,
    featured: false,
    variants: [] as {
      name: string;
      price: string;
      imageUrl: string;
      imageFile: File | null;
      preview: string | null;
    }[]
  });
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [variantPreviews, setVariantPreviews] = useState<Record<number, string | null>>({});

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
          description: item.description,
          variants:
            item.variants?.map((v: any) => ({
              id: v.id,
              name: v.name,
              price: v.price ?? null,
              imageUrl: v.imageUrl
            })) ?? []
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
      let uploadedUrl: string | undefined;
      if (form.imageFile && imagePreview) {
        const uploadRes = await fetch(`${apiBase}/uploads`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`
          },
          body: JSON.stringify({
            filename: form.imageFile.name,
            data: imagePreview
          })
        });
        const uploadData = await uploadRes.json().catch(() => ({}));
        if (!uploadRes.ok) {
          throw new Error((uploadData?.error as string) ?? "Image upload failed");
        }
        uploadedUrl = uploadData?.url as string;
      }

      const variantPayload = [];
      for (let i = 0; i < form.variants.length; i++) {
        const v = form.variants[i];
        let vUrl = v.imageUrl.trim() || undefined;
        const preview = variantPreviews[i];
        if (!vUrl && v.imageFile && preview) {
          const uploadRes = await fetch(`${apiBase}/uploads`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${token}`
            },
            body: JSON.stringify({
              filename: v.imageFile.name,
              data: preview
            })
          });
          const uploadData = await uploadRes.json().catch(() => ({}));
          if (!uploadRes.ok) {
            throw new Error((uploadData?.error as string) ?? "Variant image upload failed");
          }
          vUrl = uploadData?.url as string;
        }
        variantPayload.push({
          name: v.name.trim(),
          price: v.price ? parseFloat(v.price) : undefined,
          imageUrl: vUrl
        });
      }

      const method = editingId ? "PUT" : "POST";
      const url = editingId ? `${apiBase}/products/${editingId}` : `${apiBase}/products`;
      const res = await fetch(url, {
        method,
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
          featured: form.featured,
          imageUrl: form.imageUrl.trim() || uploadedUrl || imagePreview || undefined,
          description: form.description.trim() || undefined,
          variants: variantPayload
        })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error((data?.error as string) ?? "Could not create product");
      }

      setStatus(editingId ? "Product updated." : "Product added to catalog.");
      setForm({
        name: "",
        sku: "",
        category: "General",
        price: "",
        cost: "",
        stockQty: "0",
        imageUrl: "",
        description: "",
        imageFile: null,
        featured: false,
        variants: []
      });
      setEditingId(null);
      setImagePreview(null);
      setVariantPreviews({});
      await loadProducts(token);
    } catch (err: any) {
      setError(err?.message ?? "Could not create product");
    } finally {
      setLoading(false);
    }
  }

  async function handleDelete(id: string) {
    if (!token) {
      setError("Sign in as an admin to delete products.");
      return;
    }
    setDeletingId(id);
    setError(null);
    setStatus(null);
    try {
      const res = await fetch(`${apiBase}/products/${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok && res.status !== 204) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data?.error as string) ?? "Could not delete product");
      }
      setStatus("Product deleted.");
      await loadProducts(token);
    } catch (err: any) {
      setError(err?.message ?? "Could not delete product");
    } finally {
      setDeletingId(null);
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
            <label className="input-group" style={{ alignSelf: "flex-end" }}>
              <span>Featured</span>
              <input
                type="checkbox"
                checked={form.featured}
                onChange={(e) => setForm((prev) => ({ ...prev, featured: e.target.checked }))}
              />
            </label>
            <label className="input-group">
            <span>Price (KES)</span>
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
            <span>Cost (KES)</span>
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
            <span>Or upload image</span>
            <input
              type="file"
              accept="image/*"
              onChange={(e) => {
                const file = e.target.files?.[0] ?? null;
                setForm((prev) => ({ ...prev, imageFile: file }));
                if (file) {
                  const reader = new FileReader();
                  reader.onload = (ev) => {
                    setImagePreview(ev.target?.result as string);
                  };
                  reader.readAsDataURL(file);
                } else {
                  setImagePreview(null);
                }
              }}
            />
            {imagePreview && (
              <div style={{ marginTop: "0.5rem" }}>
                <div className="product-thumb" style={{ backgroundImage: `url(${imagePreview})`, backgroundSize: "cover", backgroundPosition: "center" }}>
                  &nbsp;
                </div>
              </div>
            )}
          </label>

          <div className="card" style={{ padding: "0.75rem", background: "#f8fafc" }}>
            <div className="hero-eyebrow" style={{ marginBottom: "0.35rem" }}>
              Variants (flavours / options)
            </div>
            <button
              className="button ghost"
              type="button"
              onClick={() =>
                setForm((prev) => ({
                  ...prev,
                  variants: [
                    ...prev.variants,
                    { name: "", price: "", imageUrl: "", imageFile: null, preview: null }
                  ]
                }))
              }
            >
              Add variant
            </button>
            <div style={{ display: "grid", gap: "0.5rem", marginTop: "0.5rem" }}>
              {form.variants.map((variant, idx) => (
                <div key={idx} className="card" style={{ padding: "0.65rem" }}>
                  <div className="input-row">
                    <label className="input-group">
                      <span>Name</span>
                      <input
                        value={variant.name}
                        onChange={(e) =>
                          setForm((prev) => {
                            const copy = [...prev.variants];
                            copy[idx] = { ...copy[idx], name: e.target.value };
                            return { ...prev, variants: copy };
                          })
                        }
                        placeholder="e.g. Vanilla, Citrus"
                      />
                    </label>
                    <label className="input-group">
                      <span>Price (KES)</span>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={variant.price}
                        onChange={(e) =>
                          setForm((prev) => {
                            const copy = [...prev.variants];
                            copy[idx] = { ...copy[idx], price: e.target.value };
                            return { ...prev, variants: copy };
                          })
                        }
                        placeholder="Optional"
                      />
                    </label>
                  </div>
                  <label className="input-group">
                    <span>Variant image URL</span>
                    <input
                      value={variant.imageUrl}
                      onChange={(e) =>
                        setForm((prev) => {
                          const copy = [...prev.variants];
                          copy[idx] = { ...copy[idx], imageUrl: e.target.value };
                          return { ...prev, variants: copy };
                        })
                      }
                      placeholder="https://..."
                    />
                  </label>
                  <label className="input-group">
                    <span>Or upload variant image</span>
                    <input
                      type="file"
                      accept="image/*"
                      onChange={(e) => {
                        const file = e.target.files?.[0] ?? null;
                        setForm((prev) => {
                          const copy = [...prev.variants];
                          copy[idx] = { ...copy[idx], imageFile: file };
                          return { ...prev, variants: copy };
                        });
                        if (file) {
                          const reader = new FileReader();
                          reader.onload = (ev) => {
                            setVariantPreviews((prev) => ({ ...prev, [idx]: ev.target?.result as string }));
                          };
                          reader.readAsDataURL(file);
                        } else {
                          setVariantPreviews((prev) => ({ ...prev, [idx]: null }));
                        }
                      }}
                    />
                    {(variantPreviews[idx] || variant.imageUrl) && (
                      <div style={{ marginTop: "0.5rem" }}>
                        <div
                          className="product-thumb"
                          style={{
                            backgroundImage: `url(${variantPreviews[idx] || variant.imageUrl})`,
                            backgroundSize: "cover",
                            backgroundPosition: "center"
                          }}
                        >
                          &nbsp;
                        </div>
                      </div>
                    )}
                  </label>
                  <button
                    className="button ghost"
                    type="button"
                    onClick={() =>
                      setForm((prev) => ({
                        ...prev,
                        variants: prev.variants.filter((_, i) => i !== idx)
                      }))
                    }
                  >
                    Remove variant
                  </button>
                </div>
              ))}
            </div>
          </div>

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
        {editingId && (
          <p className="muted small" style={{ marginTop: "0.35rem" }}>
            Editing product.{" "}
            <button className="link-button" type="button" onClick={() => setEditingId(null)}>
              Cancel
            </button>
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
              <p className="price">KES {product.price.toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
              <p className="muted small" style={{ margin: 0 }}>
                Cost: {product.cost.toFixed(2)} • Stock: {product.stockQty}
              </p>
              <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.5rem" }}>
                <button
                  className="button ghost"
                  type="button"
                  onClick={() => {
                    setEditingId(product.id);
                    setForm({
                      name: product.name,
                      sku: product.sku,
                      category: product.category ?? "General",
                      price: product.price.toString(),
                      cost: product.cost.toString(),
                      stockQty: product.stockQty.toString(),
                      imageUrl: product.imageUrl ?? "",
                      description: product.description ?? "",
                      imageFile: null,
                      featured: false,
                      variants:
                        product.variants?.map((v) => ({
                          name: v.name,
                          price: v.price ? v.price.toString() : "",
                          imageUrl: v.imageUrl ?? "",
                          imageFile: null,
                          preview: null
                        })) ?? []
                    });
                    setImagePreview(product.imageUrl ?? null);
                    setVariantPreviews({});
                  }}
                >
                  Edit
                </button>
                <button
                  className="button ghost"
                  type="button"
                  onClick={() => handleDelete(product.id)}
                  disabled={deletingId === product.id}
                >
                  {deletingId === product.id ? "Deleting..." : "Delete"}
                </button>
              </div>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
