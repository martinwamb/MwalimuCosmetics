"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import MailDashboardPage from "../mail/page";

type Product = {
  id: string;
  name: string;
  brand?: string | null;
  sku: string;
  price: number;
  compareAtPrice?: number | null;
  currency?: string | null;
  cost: number;
  stockQty: number;
  imageUrl?: string | null;
  galleryImages?: string[];
  shortDescription?: string | null;
  description?: string | null;
  productType?: string | null;
  careAreas?: string[];
  benefits?: string[];
  suitableFor?: string[];
  ingredients?: string[];
  marketingTags?: string[];
  categories?: string[];
  variants?: { id: string; name: string; price?: number | null; imageUrl?: string | null }[];
};

type FormState = {
  name: string;
  brand: string;
  sku: string;
  price: string;
  compareAtPrice: string;
  currency: string;
  cost: string;
  stockQty: string;
  imageUrl: string;
  description: string;
  shortDescription: string;
  imageFile: File | null;
  featured: boolean;
  productType: string;
  careAreas: string[];
  benefits: string[];
  suitableFor: string[];
  ingredients: string[];
  marketingTags: string[];
  variants: {
    name: string;
    price: string;
    imageUrl: string;
    imageFile: File | null;
    preview: string | null;
  }[];
};

type TagOption = {
  id: string;
  value: string;
  label: string;
  isSystem: boolean;
};

type TagGroup = {
  id: string;
  code: string;
  name: string;
  selection: string;
  required: boolean;
  editable: boolean;
  tags?: TagOption[];
};

const PRODUCT_TYPES = [
  "hair_oil",
  "hair_food",
  "hair_treatment",
  "hair_dye",
  "lotion",
  "cream",
  "body_oil",
  "cleanser",
  "toner",
  "serum",
  "shower_gel",
  "soap",
  "scrub",
  "deodorant_roll_on",
  "deodorant_spray",
  "lip_care",
  "sunscreen"
] as const;

const CARE_AREAS = ["hair", "scalp", "face", "body", "underarm", "hands_feet"] as const;
const BENEFITS = [
  "hair_growth",
  "anti_dandruff",
  "strengthening",
  "repairing",
  "moisturizing",
  "shine_gloss",
  "anti_breakage",
  "brightening",
  "even_tone",
  "anti_acne",
  "soothing",
  "hydrating",
  "firming",
  "exfoliating",
  "odour_control",
  "anti_perspirant"
] as const;
const SUITABLE_FOR = [
  "dry_skin",
  "oily_skin",
  "combination_skin",
  "sensitive_skin",
  "normal_skin",
  "natural_hair",
  "relaxed_hair",
  "colored_hair",
  "damaged_hair",
  "low_porosity",
  "high_porosity"
] as const;
const INGREDIENTS = [
  "shea_butter",
  "coconut_oil",
  "castor_oil",
  "olive_oil",
  "aloe_vera",
  "vitamin_e",
  "tea_tree",
  "glycolic_acid",
  "salicylic_acid",
  "niacinamide",
  "fragrance_free",
  "alcohol_free",
  "sulfate_free",
  "paraben_free"
] as const;
const MARKETING_TAGS = ["new_arrival", "best_seller", "featured", "seasonal", "limited_offer"] as const;

const apiBase = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

const emptyForm: FormState = {
  name: "",
  brand: "",
  sku: "",
  price: "",
  compareAtPrice: "",
  currency: "KES",
  cost: "",
  stockQty: "0",
  imageUrl: "",
  description: "",
  shortDescription: "",
  imageFile: null,
  featured: false,
  productType: "",
  careAreas: [],
  benefits: [],
  suitableFor: [],
  ingredients: [],
  marketingTags: [],
  variants: []
};

function humanize(value: string) {
  return value
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export default function ProductDashboardPage() {
  function decodeToken(tokenValue: string | null) {
    if (!tokenValue) return null;
    const parts = tokenValue.split(".");
    if (parts.length < 2) return null;
    const base = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = base.padEnd(base.length + ((4 - (base.length % 4)) % 4), "=");
    try {
      return JSON.parse(atob(padded)) as { role?: string; email?: string };
    } catch {
      return null;
    }
  }

  function normalizeStoredValue(value: string | null) {
    if (!value) return null;
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
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

  const [products, setProducts] = useState<Product[]>([]);
  const [token, setToken] = useState<string | null>(null);
  const [role, setRole] = useState<string | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>({ ...emptyForm });
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [variantPreviews, setVariantPreviews] = useState<Record<number, string | null>>({});
  const [tagGroups, setTagGroups] = useState<TagGroup[]>([]);
  const [tagError, setTagError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"products" | "mail">("products");

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
        const compareAt = typeof item.compareAtPrice === "number" ? Number(item.compareAtPrice) : null;
        const categories = Array.isArray(item.categories)
          ? item.categories
          : item.category
            ? [item.category]
            : [];
        return {
          id: item.id,
          name: item.name,
          brand: item.brand,
          sku: item.sku,
          categories,
          productType: item.productType,
          careAreas: item.careAreas ?? [],
          benefits: item.benefits ?? [],
          suitableFor: item.suitableFor ?? [],
          ingredients: item.ingredients ?? [],
          marketingTags: item.marketingTags ?? [],
          price: Number.isFinite(price) ? price : 0,
          compareAtPrice: Number.isFinite(compareAt ?? NaN) ? compareAt : null,
          currency: item.currency ?? "KES",
          cost: Number.isFinite(cost) ? cost : 0,
          stockQty: Number.isFinite(stockQty) ? stockQty : 0,
          imageUrl: item.imageUrl,
          galleryImages: item.galleryImages ?? [],
          shortDescription: item.shortDescription,
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
    const savedToken = normalizeStoredValue(typeof window !== "undefined" ? localStorage.getItem("mwalimu_token") : null);
    const savedRole = normalizeStoredValue(typeof window !== "undefined" ? localStorage.getItem("mwalimu_role") : null);
    const savedEmail = normalizeStoredValue(typeof window !== "undefined" ? localStorage.getItem("mwalimu_email") : null);
    const payload = decodeToken(savedToken);
    const resolvedRole = savedRole ?? payload?.role ?? null;
    const resolvedEmail = savedEmail ?? payload?.email ?? null;
    setToken(savedToken);
    setRole(resolvedRole);
    setEmail(resolvedEmail);
    if (resolvedRole && savedRole !== resolvedRole) {
      localStorage.setItem("mwalimu_role", resolvedRole);
    }
    if (resolvedEmail && savedEmail !== resolvedEmail) {
      localStorage.setItem("mwalimu_email", resolvedEmail);
    }
    loadProducts(savedToken);
  }, [loadProducts]);

  const isAdmin = role === "ADMIN";
  const isAccounts = role === "ACCOUNTS";
  const canManageProducts = isAdmin || isAccounts;
  const canViewMail = Boolean(email && email.toLowerCase().endsWith("@mwalimucosmetics.com"));

  useEffect(() => {
    if (!canViewMail && activeTab === "mail") {
      setActiveTab("products");
    }
  }, [activeTab, canViewMail]);

  useEffect(() => {
    async function loadTags(authToken?: string | null) {
      if (!authToken || !canManageProducts) return;
      setTagError(null);
      try {
        const res = await fetch(`${apiBase}/tags/groups?includeTags=true`, {
          headers: { Authorization: `Bearer ${authToken}` },
          cache: "no-store"
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error((data?.error as string) ?? "Could not load tags");
        setTagGroups((data?.data as TagGroup[]) ?? []);
      } catch (err: any) {
        setTagError(err?.message ?? "Could not load tags");
      }
    }

    loadTags(token);
  }, [token, canManageProducts]);

  function groupOptions(code: string, fallback: readonly string[]) {
    const group = tagGroups.find((item) => item.code === code);
    if (group?.tags?.length) {
      return group.tags.map((tag) => tag.value);
    }
    return [...fallback];
  }

  const productTypeOptions = groupOptions("product_type", PRODUCT_TYPES);
  const careAreaOptions = groupOptions("care_area", CARE_AREAS);
  const benefitOptions = groupOptions("benefit", BENEFITS);
  const suitableOptions = groupOptions("suitable_for", SUITABLE_FOR);
  const ingredientOptions = groupOptions("ingredient", INGREDIENTS);
  const marketingOptions = groupOptions("marketing", MARKETING_TAGS);

  const badgeForProduct = useCallback((product: Product) => {
    if (product.marketingTags?.includes("new_arrival")) return "New Arrival";
    if (product.marketingTags?.includes("best_seller")) return "Best Seller";
    if (product.marketingTags?.includes("featured")) return "Featured";
    if (product.categories?.length) return product.categories[0];
    if (product.productType) return humanize(product.productType);
    return "Uncategorized";
  }, []);

  function toggleList(field: keyof Pick<FormState, "careAreas" | "benefits" | "suitableFor" | "ingredients" | "marketingTags">, value: string) {
    setForm((prev) => {
      const set = new Set(prev[field]);
      if (set.has(value)) set.delete(value);
      else set.add(value);
      return { ...prev, [field]: Array.from(set) } as FormState;
    });
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setStatus(null);

    if (!token || !canManageProducts) {
      setError("Sign in as an admin or accounts user to add products.");
      return;
    }

    const price = parseFloat(form.price);
    const compareAt = form.compareAtPrice ? parseFloat(form.compareAtPrice) : null;
    const cost = parseFloat(form.cost);
    const stockQty = parseInt(form.stockQty || "0", 10);

    if (!form.productType) {
      setError("Pick a product type.");
      return;
    }
    if (form.careAreas.length === 0) {
      setError("Select at least one care area.");
      return;
    }
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
    if (compareAt !== null && !Number.isFinite(compareAt)) {
      setError("Compare-at price must be a valid number.");
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
          brand: form.brand.trim() || undefined,
          sku: form.sku.trim(),
          price,
          compareAtPrice: compareAt ?? undefined,
          currency: form.currency.trim() || "KES",
          cost,
          stockQty,
          featured: form.featured,
          imageUrl: form.imageUrl.trim() || uploadedUrl || imagePreview || undefined,
          shortDescription: form.shortDescription.trim() || undefined,
          description: form.description.trim() || undefined,
          tags: {
            productType: form.productType,
            careAreas: form.careAreas,
            benefits: form.benefits,
            suitableFor: form.suitableFor,
            ingredients: form.ingredients,
            marketingTags: form.marketingTags
          },
          variants: variantPayload
        })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error((data?.error as string) ?? "Could not create product");
      }

      setStatus(editingId ? "Product updated." : "Product added to catalog.");
      setForm({ ...emptyForm, currency: form.currency || "KES" });
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
    if (!token || !isAdmin) {
      setError("Only admins can delete products.");
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

  const categoryHint = useMemo(() => {
    if (!form.productType && form.careAreas.length === 0) return "Tag products to auto-place them in categories and homepage modules.";
    if (form.careAreas.includes("hair") || form.careAreas.includes("scalp")) return "Will show in Hair Care";
    if (form.careAreas.includes("face")) return "Will show in Skin Care";
    if (form.careAreas.includes("underarm")) return "Will show in Personal Care";
    if (form.careAreas.includes("body")) return "Will show in Bath & Body";
    return null;
  }, [form.productType, form.careAreas]);

  return (
    <div>
      {canViewMail && (
        <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1rem", flexWrap: "wrap" }}>
          <button className={`button ${activeTab === "products" ? "" : "ghost"}`} type="button" onClick={() => setActiveTab("products")}>
            Products
          </button>
          <button className={`button ${activeTab === "mail" ? "" : "ghost"}`} type="button" onClick={() => setActiveTab("mail")}>
            Messages
          </button>
        </div>
      )}

      {activeTab === "mail" && canViewMail ? (
        <MailDashboardPage />
      ) : (
        <div className="grid" style={{ gridTemplateColumns: isAdmin ? "minmax(340px, 500px) 1fr" : "minmax(340px, 1fr)", gap: "1.5rem" }}>
          <section className="card">
        <div className="hero-eyebrow" style={{ marginBottom: "0.35rem" }}>
          Catalog management
        </div>
        <h1 style={{ margin: 0 }}>Add a product</h1>
        <p className="muted" style={{ marginTop: "0.35rem" }}>
          Structured tags auto-place items into categories, homepage sections, and filters. No manual category dropdown.
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
              <span>Brand</span>
              <input value={form.brand} onChange={(e) => setForm((prev) => ({ ...prev, brand: e.target.value }))} placeholder="Optional" />
            </label>
          </div>

          <div className="input-row">
            <label className="input-group">
              <span>SKU</span>
              <input
                value={form.sku}
                onChange={(e) => setForm((prev) => ({ ...prev, sku: e.target.value }))}
                placeholder="SKU-001"
                required
              />
            </label>
            <label className="input-group">
              <span>Featured</span>
              <input
                type="checkbox"
                checked={form.featured}
                onChange={(e) => setForm((prev) => ({ ...prev, featured: e.target.checked }))}
              />
            </label>
          </div>

          <div className="card" style={{ padding: "0.75rem", background: "#f8fafc" }}>
            <div className="hero-eyebrow" style={{ marginBottom: "0.35rem" }}>
              Classification & filters
            </div>
            <label className="input-group">
              <span>Product type (single)</span>
              <select value={form.productType} onChange={(e) => setForm((prev) => ({ ...prev, productType: e.target.value }))} required>
                <option value="">Select a type</option>
                {productTypeOptions.map((type) => (
                  <option key={type} value={type}>
                    {humanize(type)}
                  </option>
                ))}
              </select>
            </label>

            <div className="input-group">
              <span>Care area (pick at least one)</span>
              <div className="pill-grid">
                {careAreaOptions.map((area) => (
                  <label key={area} className={`pill ${form.careAreas.includes(area) ? "active" : ""}`}>
                    <input
                      type="checkbox"
                      checked={form.careAreas.includes(area)}
                      onChange={() => toggleList("careAreas", area)}
                      style={{ display: "none" }}
                    />
                    {humanize(area)}
                  </label>
                ))}
              </div>
            </div>
            {categoryHint && <p className="muted small" style={{ marginTop: "0.25rem" }}>{categoryHint}</p>}

            <div className="input-group">
              <span>Benefits (multi-select)</span>
              <div className="pill-grid">
                {benefitOptions.map((benefit) => (
                  <label key={benefit} className={`pill ${form.benefits.includes(benefit) ? "active" : ""}`}>
                    <input
                      type="checkbox"
                      checked={form.benefits.includes(benefit)}
                      onChange={() => toggleList("benefits", benefit)}
                      style={{ display: "none" }}
                    />
                    {humanize(benefit)}
                  </label>
                ))}
              </div>
            </div>

            <div className="input-group">
              <span>Suitable for (hair/skin types)</span>
              <div className="pill-grid">
                {suitableOptions.map((option) => (
                  <label key={option} className={`pill ${form.suitableFor.includes(option) ? "active" : ""}`}>
                    <input
                      type="checkbox"
                      checked={form.suitableFor.includes(option)}
                      onChange={() => toggleList("suitableFor", option)}
                      style={{ display: "none" }}
                    />
                    {humanize(option)}
                  </label>
                ))}
              </div>
            </div>

            <div className="input-group">
              <span>Ingredients / formula</span>
              <div className="pill-grid">
                {ingredientOptions.map((ingredient) => (
                  <label key={ingredient} className={`pill ${form.ingredients.includes(ingredient) ? "active" : ""}`}>
                    <input
                      type="checkbox"
                      checked={form.ingredients.includes(ingredient)}
                      onChange={() => toggleList("ingredients", ingredient)}
                      style={{ display: "none" }}
                    />
                    {humanize(ingredient)}
                  </label>
                ))}
              </div>
            </div>

            <div className="input-group">
              <span>Marketing tags (drives homepage)</span>
              <div className="pill-grid">
                {marketingOptions.map((tag) => (
                  <label key={tag} className={`pill ${form.marketingTags.includes(tag) ? "active" : ""}`}>
                    <input
                      type="checkbox"
                      checked={form.marketingTags.includes(tag)}
                      onChange={() => toggleList("marketingTags", tag)}
                      style={{ display: "none" }}
                    />
                    {humanize(tag)}
                  </label>
                ))}
              </div>
            </div>
          </div>
          {tagError && (
            <p className="muted small" style={{ marginTop: "0.35rem" }}>
              {tagError} (showing default options)
            </p>
          )}

          <div className="input-row">
            <label className="input-group">
              <span>Price ({form.currency || "KES"})</span>
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
              <span>Compare-at</span>
              <input
                type="number"
                step="0.01"
                min="0"
                value={form.compareAtPrice}
                onChange={(e) => setForm((prev) => ({ ...prev, compareAtPrice: e.target.value }))}
                placeholder="Optional (drives Big Savings)"
              />
            </label>
            <label className="input-group">
              <span>Currency</span>
              <input value={form.currency} onChange={(e) => setForm((prev) => ({ ...prev, currency: e.target.value }))} placeholder="KES" />
            </label>
          </div>

          <div className="input-row">
            <label className="input-group">
              <span>Cost ({form.currency || "KES"})</span>
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
            <span>Short description (160 chars)</span>
            <input
              value={form.shortDescription}
              maxLength={160}
              onChange={(e) => setForm((prev) => ({ ...prev, shortDescription: e.target.value }))}
              placeholder="One-liner for cards"
            />
          </label>

          <label className="input-group">
            <span>Long description</span>
            <textarea
              value={form.description}
              onChange={(e) => setForm((prev) => ({ ...prev, description: e.target.value }))}
              placeholder="What makes this product great?"
              rows={3}
            />
          </label>

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
                <div
                  className="product-thumb"
                  style={{
                    backgroundImage: `url(${imagePreview})`,
                    backgroundSize: "contain",
                    backgroundRepeat: "no-repeat",
                    backgroundPosition: "center"
                  }}
                >
                  &nbsp;
                </div>
              </div>
            )}
          </label>
          <p className="muted small" style={{ marginTop: "-0.25rem" }}>
            Recommended product image size: 1200 x 1200 (minimum 800 x 800). Square images show best.
          </p>

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
                  variants: [...prev.variants, { name: "", price: "", imageUrl: "", imageFile: null, preview: null }]
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
                      <span>Price ({form.currency || "KES"})</span>
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
                            backgroundSize: "contain",
                            backgroundRepeat: "no-repeat",
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

          <button className="button" type="submit" disabled={loading}>
            {loading ? "Saving..." : editingId ? "Update product" : "Add product"}
          </button>
        </form>

        {error && <div className="signin-error">{error}</div>}
        {status && <div className="signin-success">{status}</div>}
        {!token && (
          <p className="muted small" style={{ marginTop: "0.35rem" }}>
            Sign in as an admin or accounts user to submit.
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

      {isAdmin && (
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
              <div className="badge">{badgeForProduct(product)}</div>
              <div
                className="product-thumb"
                style={
                  normalizeImageUrl(product.imageUrl)
                    ? {
                        backgroundImage: `url(${normalizeImageUrl(product.imageUrl)})`,
                        backgroundSize: "contain",
                        backgroundRepeat: "no-repeat",
                        backgroundPosition: "center"
                      }
                    : undefined
                }
              >
                {!product.imageUrl && (product.sku ?? "SKU")}
              </div>
              <h3 style={{ margin: "0.25rem 0 0" }}>{product.name}</h3>
              <p className="muted" style={{ margin: 0 }}>
                {product.shortDescription || product.description || "No description yet."}
              </p>
              <p className="price">
                {product.currency ?? "KES"} {product.price.toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                {product.compareAtPrice && product.compareAtPrice > product.price ? (
                  <span className="muted small" style={{ marginLeft: "6px" }}>
                    (was {product.compareAtPrice.toFixed(2)})
                  </span>
                ) : null}
              </p>
              <p className="muted small" style={{ margin: 0 }}>
                Cost: {product.cost.toFixed(2)} | Stock: {product.stockQty}
              </p>
              <p className="muted small" style={{ margin: "0.35rem 0 0" }}>
                {product.productType ? humanize(product.productType) : "-"} | {product.careAreas?.map(humanize).join(", ")}
              </p>
              <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.5rem" }}>
                <button
                  className="button ghost"
                  type="button"
                  onClick={() => {
                    setEditingId(product.id);
                    setForm({
                      name: product.name,
                      brand: product.brand ?? "",
                      sku: product.sku,
                      price: product.price.toString(),
                      compareAtPrice: product.compareAtPrice ? product.compareAtPrice.toString() : "",
                      currency: product.currency ?? "KES",
                      cost: product.cost.toString(),
                      stockQty: product.stockQty.toString(),
                      imageUrl: product.imageUrl ?? "",
                      description: product.description ?? "",
                      shortDescription: product.shortDescription ?? "",
                      imageFile: null,
                      featured: product.marketingTags?.includes("featured") ?? false,
                      productType: product.productType ?? "",
                      careAreas: product.careAreas ?? [],
                      benefits: product.benefits ?? [],
                      suitableFor: product.suitableFor ?? [],
                      ingredients: product.ingredients ?? [],
                      marketingTags: product.marketingTags ?? [],
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
      )}
    </div>
      )}
    </div>
  );
}










