"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";

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
  id?: string;
  label: string;
  imageUrl?: string | null;
  linkType?: "URL" | "CATEGORY" | "PRODUCT" | "FILTER";
  linkTarget?: string | null;
  badge?: string | null;
  sortOrder?: number;
  preview?: string | null;
  file?: File | null;
};

type SectionItemForm = SectionItem & {
  filterProductTypes: string[];
  filterCareAreas: string[];
  filterSuitableFor: string[];
  filterIngredients: string[];
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
  tags?: TagOption[];
};

const apiBase = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

const emptyBanner = {
  title: "",
  subtext: "",
  ctaText: "",
  ctaLink: "",
  imageUrl: "",
  enabled: true,
  sortOrder: 0,
  preview: null as string | null,
  file: null as File | null
};

const EMPTY_FILTERS = {
  filterProductTypes: [],
  filterCareAreas: [],
  filterSuitableFor: [],
  filterIngredients: []
};

function blankItem(sectionType: Section["type"], order: number): SectionItemForm {
  return {
    label: "",
    imageUrl: "",
    linkType: sectionType === "CATEGORY" ? "FILTER" : sectionType === "BEST_SELLERS" ? "PRODUCT" : "URL",
    linkTarget: "",
    badge: "",
    sortOrder: order,
    file: null,
    preview: null,
    ...EMPTY_FILTERS
  };
}

function buildDefaultItems(sectionType: Section["type"]) {
  if (sectionType !== "CATEGORY") return [] as SectionItemForm[];
  return Array.from({ length: 4 }, (_, idx) => blankItem(sectionType, idx));
}

const emptySection = {
  type: "CATEGORY" as Section["type"],
  title: "",
  subtitle: "",
  enabled: true,
  sortOrder: 0,
  items: buildDefaultItems("CATEGORY")
};

export default function HomepageAdminPage() {
  const [token, setToken] = useState<string | null>(null);
  const [banners, setBanners] = useState<Banner[]>([]);
  const [sections, setSections] = useState<Section[]>([]);
  const [tagGroups, setTagGroups] = useState<TagGroup[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const [bannerForm, setBannerForm] = useState({ ...emptyBanner });
  const [editingBannerId, setEditingBannerId] = useState<string | null>(null);

  const [sectionForm, setSectionForm] = useState({ ...emptySection });
  const [editingSectionId, setEditingSectionId] = useState<string | null>(null);
  const [itemPreviews, setItemPreviews] = useState<Record<number, string | null>>({});

  useEffect(() => {
    try {
      const saved = typeof window !== "undefined" ? localStorage.getItem("mwalimu_token") : null;
      setToken(saved);
    } catch {
      setToken(null);
    }
  }, []);

  useEffect(() => {
    if (!token) return;
    loadData();
  }, [token]);

  const sortedBanners = useMemo(() => [...banners].sort((a, b) => a.sortOrder - b.sortOrder), [banners]);
  const sortedSections = useMemo(() => [...sections].sort((a, b) => a.sortOrder - b.sortOrder), [sections]);

  async function loadData() {
    if (!token) return;
    setError(null);
    try {
      const [bannerRes, sectionRes, tagRes] = await Promise.all([
        fetch(`${apiBase}/homepage/banners`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" }),
        fetch(`${apiBase}/homepage/sections`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" }),
        fetch(`${apiBase}/tags/groups?includeTags=true`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" })
      ]);
      const bannerJson = await bannerRes.json().catch(() => ({}));
      const sectionJson = await sectionRes.json().catch(() => ({}));
      const tagJson = await tagRes.json().catch(() => ({}));
      if (!bannerRes.ok) throw new Error((bannerJson?.error as string) ?? "Could not load banners");
      if (!sectionRes.ok) throw new Error((sectionJson?.error as string) ?? "Could not load sections");
      if (!tagRes.ok) throw new Error((tagJson?.error as string) ?? "Could not load tag options");
      setBanners((bannerJson?.data as Banner[]) ?? []);
      setSections((sectionJson?.data as Section[]) ?? []);
      setTagGroups((tagJson?.data as TagGroup[]) ?? []);
    } catch (err: any) {
      setError(err?.message ?? "Unable to load homepage content.");
    }
  }

  async function uploadImage(file: File, preview: string | null) {
    if (!token) throw new Error("Sign in again.");
    if (!preview) {
      const reader = new FileReader();
      const base64: string = await new Promise((resolve, reject) => {
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      return uploadImage(file, base64);
    }

    const res = await fetch(`${apiBase}/uploads`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({ filename: file.name, data: preview })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error((data?.error as string) ?? "Image upload failed");
    return data?.url as string;
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

  function ensureCategoryItems(items: SectionItemForm[]) {
    const next = [...items];
    while (next.length < 4) {
      next.push(blankItem("CATEGORY", next.length));
    }
    return next.slice(0, 4);
  }

  function updateItem(index: number, updates: Partial<SectionItemForm>) {
    setSectionForm((prev) => {
      const copy = [...prev.items];
      copy[index] = { ...copy[index], ...updates };
      return { ...prev, items: copy };
    });
  }

  function toggleItemFilter(index: number, field: keyof SectionItemForm, value: string) {
    setSectionForm((prev) => {
      const copy = [...prev.items];
      const list = (copy[index][field] as string[]) ?? [];
      copy[index] = {
        ...copy[index],
        [field]: list.includes(value) ? list.filter((item) => item !== value) : [...list, value]
      };
      return { ...prev, items: copy };
    });
  }

  function parseFilterTarget(target?: string | null) {
    const raw = target?.trim();
    if (!raw) return { ...EMPTY_FILTERS };
    const query = raw.includes("?") ? raw.split("?")[1] : raw;
    const params = new URLSearchParams(query);
    const parseList = (value: string | null) =>
      value ? value.split(",").map((entry) => entry.trim()).filter(Boolean) : [];
    return {
      filterProductTypes: parseList(params.get("productType")),
      filterCareAreas: parseList(params.get("careArea")),
      filterSuitableFor: parseList(params.get("suitableFor")),
      filterIngredients: parseList(params.get("ingredient"))
    };
  }

  function buildFilterTarget(item: SectionItemForm) {
    const params = new URLSearchParams();
    if (item.filterProductTypes.length) params.set("productType", item.filterProductTypes.join(","));
    if (item.filterCareAreas.length) params.set("careArea", item.filterCareAreas.join(","));
    if (item.filterSuitableFor.length) params.set("suitableFor", item.filterSuitableFor.join(","));
    if (item.filterIngredients.length) params.set("ingredient", item.filterIngredients.join(","));
    return params.toString();
  }

  const tagOptions = useMemo(() => {
    const map: Record<string, TagOption[]> = {};
    tagGroups.forEach((group) => {
      map[group.code] = group.tags ?? [];
    });
    return map;
  }, [tagGroups]);

  async function handleSaveBanner(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setStatus(null);
    if (!token) {
      setError("Sign in as an admin to manage homepage.");
      return;
    }

    if (!bannerForm.title.trim()) {
      setError("Banner needs a title.");
      return;
    }

    setLoading(true);
    try {
      let imageUrl = bannerForm.imageUrl.trim();
      if (bannerForm.file) {
        imageUrl = await uploadImage(bannerForm.file, bannerForm.preview);
      }
      if (!imageUrl) throw new Error("Add a banner image.");

      const payload = {
        title: bannerForm.title.trim(),
        subtext: bannerForm.subtext?.trim() || undefined,
        ctaText: bannerForm.ctaText?.trim() || undefined,
        ctaLink: bannerForm.ctaLink?.trim() || undefined,
        imageUrl,
        enabled: bannerForm.enabled,
        sortOrder: bannerForm.sortOrder
      };

      const method = editingBannerId ? "PUT" : "POST";
      const url = editingBannerId ? `${apiBase}/homepage/banners/${editingBannerId}` : `${apiBase}/homepage/banners`;

      const res = await fetch(url, {
        method,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify(payload)
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data?.error as string) ?? "Could not save banner");

      setStatus(editingBannerId ? "Banner updated." : "Banner added.");
      setBannerForm({ ...emptyBanner, sortOrder: banners.length });
      setEditingBannerId(null);
      await loadData();
    } catch (err: any) {
      setError(err?.message ?? "Could not save banner.");
    } finally {
      setLoading(false);
    }
  }

  function moveBanner(id: string, direction: "up" | "down") {
    const ordered = [...sortedBanners];
    const index = ordered.findIndex((b) => b.id === id);
    if (index === -1) return;
    const swapIndex = direction === "up" ? index - 1 : index + 1;
    if (swapIndex < 0 || swapIndex >= ordered.length) return;
    [ordered[index], ordered[swapIndex]] = [ordered[swapIndex], ordered[index]];
    const withOrder = ordered.map((banner, idx) => ({ ...banner, sortOrder: idx }));
    setBanners(withOrder);
    persistBannerOrder(withOrder);
  }

  async function persistBannerOrder(list: Banner[]) {
    if (!token) return;
    try {
      await fetch(`${apiBase}/homepage/banners/reorder`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify(list.map((b, idx) => ({ id: b.id, sortOrder: idx })))
      });
    } catch {
      // ignore; UI already updated optimistically
    }
  }

  async function toggleBanner(id: string, next: boolean) {
    if (!token) return;
    setBanners((prev) => prev.map((b) => (b.id === id ? { ...b, enabled: next } : b)));
    try {
      await fetch(`${apiBase}/homepage/banners/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ enabled: next })
      });
    } catch (err: any) {
      setError(err?.message ?? "Could not update banner state.");
      await loadData();
    }
  }

  async function handleSaveSection(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setStatus(null);
    if (!token) {
      setError("Sign in as an admin to manage homepage.");
      return;
    }
    if (!sectionForm.title.trim()) {
      setError("Section needs a title.");
      return;
    }
    if (sectionForm.type === "CATEGORY" && sectionForm.items.length !== 4) {
      setError("Category sections must have exactly 4 subcategories.");
      return;
    }

    setLoading(true);
    try {
      const itemsPayload = [];
      for (let i = 0; i < sectionForm.items.length; i++) {
        const item = sectionForm.items[i];
        let imageUrl = item.imageUrl?.trim() ?? "";
        const preview = item.preview ?? itemPreviews[i] ?? null;
        if (item.file && preview) {
          imageUrl = await uploadImage(item.file, preview);
        }
        const linkType = sectionForm.type === "CATEGORY" ? "FILTER" : item.linkType ?? "URL";
        const linkTarget =
          linkType === "FILTER" ? buildFilterTarget(item) : item.linkTarget?.trim() || "";
        if (linkType === "FILTER" && !linkTarget) {
          throw new Error(`Add at least one filter for item ${i + 1}.`);
        }
        itemsPayload.push({
          label: item.label.trim(),
          imageUrl: imageUrl || undefined,
          linkType,
          linkTarget: linkTarget || undefined,
          badge: item.badge?.trim() || undefined,
          sortOrder: item.sortOrder ?? i
        });
      }

      const payload = {
        type: sectionForm.type,
        title: sectionForm.title.trim(),
        subtitle: sectionForm.subtitle?.trim() || undefined,
        enabled: sectionForm.enabled,
        sortOrder: sectionForm.sortOrder,
        items: itemsPayload
      };

      const method = editingSectionId ? "PUT" : "POST";
      const url = editingSectionId ? `${apiBase}/homepage/sections/${editingSectionId}` : `${apiBase}/homepage/sections`;

      const res = await fetch(url, {
        method,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify(payload)
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data?.error as string) ?? "Could not save section");

      setStatus(editingSectionId ? "Section updated." : "Section added.");
      setSectionForm({ ...emptySection, sortOrder: sections.length });
      setItemPreviews({});
      setEditingSectionId(null);
      await loadData();
    } catch (err: any) {
      setError(err?.message ?? "Could not save section.");
    } finally {
      setLoading(false);
    }
  }

  function moveSection(id: string, direction: "up" | "down") {
    const ordered = [...sortedSections];
    const index = ordered.findIndex((s) => s.id === id);
    if (index === -1) return;
    const swapIndex = direction === "up" ? index - 1 : index + 1;
    if (swapIndex < 0 || swapIndex >= ordered.length) return;
    [ordered[index], ordered[swapIndex]] = [ordered[swapIndex], ordered[index]];
    const withOrder = ordered.map((section, idx) => ({ ...section, sortOrder: idx }));
    setSections(withOrder);
    persistSectionOrder(withOrder);
  }

  async function persistSectionOrder(list: Section[]) {
    if (!token) return;
    try {
      await fetch(`${apiBase}/homepage/sections/reorder`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify(list.map((s, idx) => ({ id: s.id, sortOrder: idx })))
      });
    } catch {
      // ignore
    }
  }

  async function toggleSection(id: string, next: boolean) {
    if (!token) return;
    setSections((prev) => prev.map((s) => (s.id === id ? { ...s, enabled: next } : s)));
    try {
      await fetch(`${apiBase}/homepage/sections/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ enabled: next })
      });
    } catch (err: any) {
      setError(err?.message ?? "Could not update section state.");
      await loadData();
    }
  }

  function editBanner(banner: Banner) {
    setEditingBannerId(banner.id);
    setBannerForm({
      title: banner.title,
      subtext: banner.subtext ?? "",
      ctaText: banner.ctaText ?? "",
      ctaLink: banner.ctaLink ?? "",
      imageUrl: banner.imageUrl,
      enabled: banner.enabled,
      sortOrder: banner.sortOrder,
      preview: banner.imageUrl,
      file: null
    });
  }

  function editSection(section: Section) {
    setEditingSectionId(section.id);
    const mappedItems = section.items.map((item) => {
      const filters = item.linkType === "FILTER" ? parseFilterTarget(item.linkTarget) : { ...EMPTY_FILTERS };
      return {
        id: item.id,
        label: item.label,
        imageUrl: item.imageUrl ?? "",
        linkType: item.linkType ?? "URL",
        linkTarget: item.linkTarget ?? "",
        badge: item.badge ?? "",
        sortOrder: item.sortOrder ?? 0,
        file: null,
        preview: null,
        ...filters
      };
    });
    setSectionForm({
      type: section.type,
      title: section.title,
      subtitle: section.subtitle ?? "",
      enabled: section.enabled,
      sortOrder: section.sortOrder,
      items: section.type === "CATEGORY" ? ensureCategoryItems(mappedItems) : mappedItems
    });
    setItemPreviews({});
  }

  function resetBannerForm() {
    setEditingBannerId(null);
    setBannerForm({ ...emptyBanner, sortOrder: banners.length });
  }

  function resetSectionForm() {
    setEditingSectionId(null);
    setSectionForm({ ...emptySection, sortOrder: sections.length });
    setItemPreviews({});
  }

  const isCategorySection = sectionForm.type === "CATEGORY";
  const productTypeOptions = tagOptions["product_type"] ?? [];
  const careAreaOptions = tagOptions["care_area"] ?? [];
  const suitableOptions = tagOptions["suitable_for"] ?? [];
  const ingredientOptions = tagOptions["ingredient"] ?? [];

  return (
    <div className="grid" style={{ gridTemplateColumns: "minmax(340px, 400px) 1fr", gap: "1.25rem" }}>
      <section className="card">
        <div className="hero-eyebrow" style={{ marginBottom: "0.3rem" }}>
          Homepage layout
        </div>
        <h1 style={{ margin: 0 }}>Manage banners & sections</h1>
        <p className="muted" style={{ marginTop: "0.35rem" }}>
          Set a full-width hero carousel (3–5 slides) and toggle homepage sections. Upload imagery, edit text/links, and reorder.
        </p>

        {error && <div className="signin-error" style={{ marginTop: "0.5rem" }}>{error}</div>}
        {status && <div className="signin-success" style={{ marginTop: "0.5rem" }}>{status}</div>}
        {!token && (
          <p className="muted small" style={{ marginTop: "0.35rem" }}>
            Sign in as ADMIN to change the homepage.
          </p>
        )}
      </section>

      <section className="card">
        <div className="hero-eyebrow" style={{ marginBottom: "0.35rem" }}>
          Banners (hero carousel)
        </div>
        <form className="signin-form" onSubmit={handleSaveBanner}>
          <label className="input-group">
            <span>Headline</span>
            <input value={bannerForm.title} onChange={(e) => setBannerForm((prev) => ({ ...prev, title: e.target.value }))} required />
          </label>
          <label className="input-group">
            <span>Subtext</span>
            <textarea value={bannerForm.subtext ?? ""} onChange={(e) => setBannerForm((prev) => ({ ...prev, subtext: e.target.value }))} rows={2} />
          </label>
          <div className="input-row">
            <label className="input-group">
              <span>CTA text</span>
              <input value={bannerForm.ctaText ?? ""} onChange={(e) => setBannerForm((prev) => ({ ...prev, ctaText: e.target.value }))} />
            </label>
            <label className="input-group">
              <span>CTA link</span>
              <input value={bannerForm.ctaLink ?? ""} onChange={(e) => setBannerForm((prev) => ({ ...prev, ctaLink: e.target.value }))} placeholder="/products" />
            </label>
          </div>
          <label className="input-group">
            <span>Image URL</span>
            <input value={bannerForm.imageUrl} onChange={(e) => setBannerForm((prev) => ({ ...prev, imageUrl: e.target.value }))} placeholder="https://..." />
          </label>
          <label className="input-group">
            <span>Or upload image</span>
            <input
              type="file"
              accept="image/*"
              onChange={(e) => {
                const file = e.target.files?.[0] ?? null;
                setBannerForm((prev) => ({ ...prev, file, preview: null }));
                if (file) {
                  const reader = new FileReader();
                  reader.onload = (ev) => setBannerForm((prev) => ({ ...prev, preview: ev.target?.result as string }));
                  reader.readAsDataURL(file);
                }
              }}
            />
            {(bannerForm.preview || bannerForm.imageUrl) && (
              <div style={{ marginTop: "0.5rem" }}>
                <div
                  className="product-thumb"
                  style={{
                    height: 140,
                    backgroundImage: `url(${bannerForm.preview || bannerForm.imageUrl})`,
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
            Recommended banner size: 1600 x 600 (minimum 1200 x 500). Images display full-size without cropping.
          </p>
          <div className="input-row" style={{ alignItems: "center" }}>
            <label className="input-group" style={{ flex: 1 }}>
              <span>Sort order</span>
              <input
                type="number"
                min={0}
                value={bannerForm.sortOrder}
                onChange={(e) => setBannerForm((prev) => ({ ...prev, sortOrder: Number(e.target.value) }))}
              />
            </label>
            <label className="input-group" style={{ alignSelf: "flex-end" }}>
              <span>Enabled</span>
              <input type="checkbox" checked={bannerForm.enabled} onChange={(e) => setBannerForm((prev) => ({ ...prev, enabled: e.target.checked }))} />
            </label>
          </div>
          <div style={{ display: "flex", gap: "0.5rem" }}>
            <button className="button" type="submit" disabled={loading}>
              {loading ? "Saving..." : editingBannerId ? "Update banner" : "Add banner"}
            </button>
            {editingBannerId && (
              <button className="button ghost" type="button" onClick={resetBannerForm}>
                Cancel
              </button>
            )}
          </div>
          <p className="muted small" style={{ margin: "0.35rem 0 0" }}>
            Keep 3–5 banners enabled for the carousel.
          </p>
        </form>

        <div style={{ marginTop: "1rem" }}>
          <div className="hero-eyebrow" style={{ marginBottom: "0.35rem" }}>
            Current banners
          </div>
          {!sortedBanners.length && <p className="muted small">No banners yet. Add up to 5 slides.</p>}
          <div className="catalog-grid">
            {sortedBanners.map((banner) => (
              <article key={banner.id} className="product-card" style={{ gap: "0.35rem" }}>
                <div className="badge">{banner.enabled ? "Enabled" : "Disabled"}</div>
                <div
                  className="product-thumb"
                  style={{
                    height: 120,
                    backgroundImage: normalizeImageUrl(banner.imageUrl) ? `url(${normalizeImageUrl(banner.imageUrl)})` : undefined,
                    backgroundSize: "contain",
                    backgroundRepeat: "no-repeat",
                    backgroundPosition: "center"
                  }}
                >
                  {!banner.imageUrl && "Add image"}
                </div>
                <strong>{banner.title}</strong>
                <p className="muted small" style={{ margin: 0 }}>
                  {banner.subtext || "No subtext"} · Order {banner.sortOrder}
                </p>
                <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap", marginTop: "0.25rem" }}>
                  <button className="button ghost" type="button" onClick={() => moveBanner(banner.id, "up")}>
                    ↑
                  </button>
                  <button className="button ghost" type="button" onClick={() => moveBanner(banner.id, "down")}>
                    ↓
                  </button>
                  <button className="button ghost" type="button" onClick={() => editBanner(banner)}>
                    Edit
                  </button>
                  <label style={{ display: "inline-flex", alignItems: "center", gap: "0.35rem", fontWeight: 700 }}>
                    <input type="checkbox" checked={banner.enabled} onChange={(e) => toggleBanner(banner.id, e.target.checked)} /> Enable
                  </label>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="card" style={{ gridColumn: "1 / -1" }}>
        <div className="hero-eyebrow" style={{ marginBottom: "0.35rem" }}>
          Sections (modular)
        </div>
        <form className="signin-form" onSubmit={handleSaveSection}>
          <div className="input-row">
            <label className="input-group">
              <span>Section type</span>
              <select
                value={sectionForm.type}
                onChange={(e) => {
                  const nextType = e.target.value as Section["type"];
                  setSectionForm((prev) => {
                    const nextItems =
                      nextType === "CATEGORY"
                        ? ensureCategoryItems(
                            prev.items.map((item, idx) => ({
                              ...EMPTY_FILTERS,
                              ...item,
                              linkType: "FILTER",
                              sortOrder: item.sortOrder ?? idx
                            }))
                          )
                        : prev.items;
                    return { ...prev, type: nextType, items: nextItems };
                  });
                }}
              >
                <option value="CATEGORY">Shop by Category</option>
                <option value="NEED">Shop by Need</option>
                <option value="FEATURED_COLLECTION">Featured Collection</option>
                <option value="BEST_SELLERS">Best Sellers</option>
                <option value="PRICE">Shop by Price</option>
              </select>
            </label>
            <label className="input-group" style={{ flex: 1 }}>
              <span>Enabled</span>
              <input
                type="checkbox"
                checked={sectionForm.enabled}
                onChange={(e) => setSectionForm((prev) => ({ ...prev, enabled: e.target.checked }))}
              />
            </label>
            <label className="input-group" style={{ flex: 1 }}>
              <span>Sort order</span>
              <input
                type="number"
                min={0}
                value={sectionForm.sortOrder}
                onChange={(e) => setSectionForm((prev) => ({ ...prev, sortOrder: Number(e.target.value) }))}
              />
            </label>
          </div>
          <label className="input-group">
            <span>Title</span>
            <input value={sectionForm.title} onChange={(e) => setSectionForm((prev) => ({ ...prev, title: e.target.value }))} required />
          </label>
          <label className="input-group">
            <span>Subtitle</span>
            <input value={sectionForm.subtitle ?? ""} onChange={(e) => setSectionForm((prev) => ({ ...prev, subtitle: e.target.value }))} />
          </label>

          <div className="card" style={{ padding: "0.75rem", background: "#f8fafc" }}>
            <div className="hero-eyebrow" style={{ marginBottom: "0.35rem" }}>
              Items (cards / tiles)
            </div>
            {isCategorySection && (
              <p className="muted small" style={{ marginTop: 0 }}>
                Category sections always show 4 subcategories. Use tag filters to pick which products appear for each tile.
              </p>
            )}
            <button
              className="button ghost"
              type="button"
              disabled={isCategorySection}
              onClick={() =>
                setSectionForm((prev) => ({
                  ...prev,
                  items: [...prev.items, blankItem(prev.type, prev.items.length)]
                }))
              }
            >
              {isCategorySection ? "Category sections use 4 items" : "Add item"}
            </button>
            <div style={{ display: "grid", gap: "0.6rem", marginTop: "0.6rem" }}>
              {sectionForm.items.map((item, idx) => (
                <div key={idx} className="card" style={{ padding: "0.65rem" }}>
                  <div className="input-row">
                    <label className="input-group">
                      <span>Label</span>
                      <input
                        value={item.label}
                        onChange={(e) => updateItem(idx, { label: e.target.value })}
                        required
                      />
                    </label>
                    <label className="input-group">
                      <span>Badge (optional)</span>
                      <input
                        value={item.badge ?? ""}
                        onChange={(e) => updateItem(idx, { badge: e.target.value })}
                      />
                    </label>
                  </div>
                  <div className="input-row">
                    <label className="input-group">
                      <span>Link type</span>
                      <select
                        value={item.linkType ?? "URL"}
                        onChange={(e) => updateItem(idx, { linkType: e.target.value as SectionItem["linkType"] })}
                        disabled={isCategorySection}
                      >
                        <option value="URL">URL</option>
                        <option value="CATEGORY">Category</option>
                        <option value="PRODUCT">Product</option>
                        <option value="FILTER">Filter</option>
                      </select>
                    </label>
                    <label className="input-group">
                      <span>Link target</span>
                      <input
                        value={item.linkType === "FILTER" ? buildFilterTarget(item) : item.linkTarget ?? ""}
                        onChange={(e) => updateItem(idx, { linkTarget: e.target.value })}
                        placeholder={item.linkType === "FILTER" ? "Filters auto-generate the link" : "/products?category=..."}
                        readOnly={item.linkType === "FILTER"}
                      />
                    </label>
                    <label className="input-group">
                      <span>Order</span>
                      <input
                        type="number"
                        min={0}
                        value={item.sortOrder ?? idx}
                        onChange={(e) => updateItem(idx, { sortOrder: Number(e.target.value) })}
                      />
                    </label>
                  </div>
                  {(isCategorySection || item.linkType === "FILTER") && (
                    <div className="card" style={{ padding: "0.6rem", background: "#fff" }}>
                      <div className="hero-eyebrow" style={{ marginBottom: "0.25rem" }}>
                        Filtered products
                      </div>
                      {!tagGroups.length && <p className="muted small">Tag options will appear here after loading.</p>}
                      {Boolean(productTypeOptions.length) && (
                        <div className="input-group">
                          <span>Product type</span>
                          <div className="filter-row">
                            {productTypeOptions.map((option) => (
                              <label key={option.id} className="filter-item">
                                <input
                                  type="checkbox"
                                  checked={item.filterProductTypes.includes(option.value)}
                                  onChange={() => toggleItemFilter(idx, "filterProductTypes", option.value)}
                                />
                                <span>{option.label}</span>
                              </label>
                            ))}
                          </div>
                        </div>
                      )}
                      {Boolean(careAreaOptions.length) && (
                        <div className="input-group">
                          <span>Care area</span>
                          <div className="filter-row">
                            {careAreaOptions.map((option) => (
                              <label key={option.id} className="filter-item">
                                <input
                                  type="checkbox"
                                  checked={item.filterCareAreas.includes(option.value)}
                                  onChange={() => toggleItemFilter(idx, "filterCareAreas", option.value)}
                                />
                                <span>{option.label}</span>
                              </label>
                            ))}
                          </div>
                        </div>
                      )}
                      {Boolean(suitableOptions.length) && (
                        <div className="input-group">
                          <span>Suitable for</span>
                          <div className="filter-row">
                            {suitableOptions.map((option) => (
                              <label key={option.id} className="filter-item">
                                <input
                                  type="checkbox"
                                  checked={item.filterSuitableFor.includes(option.value)}
                                  onChange={() => toggleItemFilter(idx, "filterSuitableFor", option.value)}
                                />
                                <span>{option.label}</span>
                              </label>
                            ))}
                          </div>
                        </div>
                      )}
                      {Boolean(ingredientOptions.length) && (
                        <div className="input-group">
                          <span>Ingredients</span>
                          <div className="filter-row">
                            {ingredientOptions.map((option) => (
                              <label key={option.id} className="filter-item">
                                <input
                                  type="checkbox"
                                  checked={item.filterIngredients.includes(option.value)}
                                  onChange={() => toggleItemFilter(idx, "filterIngredients", option.value)}
                                />
                                <span>{option.label}</span>
                              </label>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                  <label className="input-group">
                    <span>Image URL</span>
                    <input
                      value={item.imageUrl ?? ""}
                      onChange={(e) => updateItem(idx, { imageUrl: e.target.value })}
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
                        updateItem(idx, { file, preview: null });
                        if (file) {
                          const reader = new FileReader();
                          reader.onload = (ev) => setItemPreviews((prev) => ({ ...prev, [idx]: ev.target?.result as string }));
                          reader.readAsDataURL(file);
                        } else {
                          setItemPreviews((prev) => ({ ...prev, [idx]: null }));
                        }
                      }}
                    />
                    {(itemPreviews[idx] || item.imageUrl) && (
                      <div style={{ marginTop: "0.5rem" }}>
                        <div
                          className="product-thumb"
                          style={{
                            height: 120,
                            backgroundImage: `url(${itemPreviews[idx] || item.imageUrl})`,
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
                  <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.25rem" }}>
                    <button
                      className="button ghost"
                      type="button"
                      disabled={isCategorySection}
                      onClick={() =>
                        setSectionForm((prev) => ({
                          ...prev,
                          items: prev.items.filter((_, i) => i !== idx)
                        }))
                      }
                    >
                      {isCategorySection ? "Fixed slot" : "Remove"}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div style={{ display: "flex", gap: "0.5rem" }}>
            <button className="button" type="submit" disabled={loading}>
              {loading ? "Saving..." : editingSectionId ? "Update section" : "Add section"}
            </button>
            {editingSectionId && (
              <button className="button ghost" type="button" onClick={resetSectionForm}>
                Cancel
              </button>
            )}
          </div>
        </form>
      </section>

      <section className="card" style={{ gridColumn: "1 / -1" }}>
        <div className="hero-eyebrow" style={{ marginBottom: "0.35rem" }}>
          Current sections
        </div>
        {!sortedSections.length && <p className="muted small">Add sections for category, need, featured collection, best sellers, or price.</p>}
        <div className="catalog-grid">
          {sortedSections.map((section) => (
            <article key={section.id} className="product-card" style={{ gap: "0.35rem" }}>
              <div className="badge">{section.enabled ? section.type : "Disabled"}</div>
              <strong>{section.title}</strong>
              {section.subtitle && (
                <p className="muted small" style={{ margin: 0 }}>
                  {section.subtitle}
                </p>
              )}
              <p className="muted small" style={{ margin: 0 }}>
                Order {section.sortOrder} · {section.items.length} items
              </p>
              <div className="deal-grid">
                {section.items.slice(0, 4).map((item) => (
                  <div key={item.id ?? item.label} className="deal-tile" style={{ textAlign: "left" }}>
                    {item.badge && <div className="mini-pill">{item.badge}</div>}
                    <strong>{item.label}</strong>
                    <p className="muted small" style={{ margin: "0.25rem 0 0" }}>
                      {item.linkType ?? "URL"} {item.linkTarget ? `→ ${item.linkTarget}` : ""}
                    </p>
                  </div>
                ))}
              </div>
              <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap", marginTop: "0.35rem" }}>
                <button className="button ghost" type="button" onClick={() => moveSection(section.id, "up")}>
                  ↑
                </button>
                <button className="button ghost" type="button" onClick={() => moveSection(section.id, "down")}>
                  ↓
                </button>
                <button className="button ghost" type="button" onClick={() => editSection(section)}>
                  Edit
                </button>
                <label style={{ display: "inline-flex", alignItems: "center", gap: "0.35rem", fontWeight: 700 }}>
                  <input type="checkbox" checked={section.enabled} onChange={(e) => toggleSection(section.id, e.target.checked)} /> Enable
                </label>
              </div>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
