type Product = {
  id: string;
  name: string;
  description: string;
  price: number;
  rating: number;
  reviews: number;
  badge?: string;
  delivery: string;
  tagline: string;
};

const catalog: Product[] = [
  {
    id: "p-1",
    name: "Shea Body Butter",
    description: "Whipped, ultra-rich butter that leaves a soft, dewy finish without greasiness.",
    price: 15.5,
    rating: 4.7,
    reviews: 241,
    badge: "Bestseller",
    delivery: "FREE next-day delivery",
    tagline: "Deep moisture"
  },
  {
    id: "p-2",
    name: "Vitamin C Serum",
    description: "High-potency 15% C + hyaluronic acid serum for bright, even-toned skin.",
    price: 25.0,
    rating: 4.8,
    reviews: 184,
    badge: "Choice",
    delivery: "Arrives Thursday",
    tagline: "Glow booster"
  },
  {
    id: "p-3",
    name: "Matte Lipstick Duo",
    description: "Two-piece long-wear matte lipstick kit with bold, conditioning pigment.",
    price: 18.0,
    rating: 4.6,
    reviews: 129,
    delivery: "Prime-style same-day",
    tagline: "All-day color"
  },
  {
    id: "p-4",
    name: "Hydrating Cleanser",
    description: "Creamy, pH-balanced cleanser that removes makeup while keeping moisture in.",
    price: 13.5,
    rating: 4.5,
    reviews: 92,
    delivery: "FREE delivery Tuesday",
    tagline: "Gentle cleanse"
  },
  {
    id: "p-5",
    name: "Restorative Hair Oil",
    description: "Lightweight hair oil with argan + baobab for shine, slip, and scalp comfort.",
    price: 22.0,
    rating: 4.7,
    reviews: 167,
    delivery: "Tomorrow by 10pm",
    tagline: "Frizz control"
  },
  {
    id: "p-6",
    name: "Overnight Renewal Mask",
    description: "Ceramide sleep mask that seals in hydration and wakes skin up plump.",
    price: 28.0,
    rating: 4.9,
    reviews: 73,
    badge: "New",
    delivery: "FREE delivery Friday",
    tagline: "Skin reset"
  }
];

export default function Page() {
  return (
    <div>
      <section className="hero">
        <div className="hero-card">
          <div className="hero-eyebrow">Amazon-inspired shopping</div>
          <h1>Shop Mwalimu like you would on Amazon</h1>
          <p className="muted">
            Familiar navigation, crisp product tiles, Prime-style delivery cues, and a bright add-to-cart flow crafted
            for fast decisions.
          </p>
          <div className="hero-actions">
            <button className="button">Shop bestsellers</button>
            <button className="button ghost">View bundles</button>
          </div>
          <div className="hero-pill-row">
            <span className="mini-pill">✓ Prime-style shipping</span>
            <span className="mini-pill">✓ 30-day returns</span>
            <span className="mini-pill">✓ Secure checkout</span>
          </div>
        </div>
        <div className="deal-card">
          <strong style={{ fontSize: "1.05rem" }}>Beauty & wellness dashboard</strong>
          <p className="muted" style={{ marginTop: "0.3rem" }}>
            Keep tabs on delivery promises, restocks, and impulse-friendly offers that mirror the Amazon feel.
          </p>
          <div className="deal-grid">
            {["Same-day delivery", "Add-on deals", "Subscribe & save", "Bundles & gifts"].map((tile) => (
              <div key={tile} className="deal-tile">
                <strong>{tile}</strong>
                <p className="muted" style={{ margin: "0.35rem 0 0" }}>
                  Manage spotlight promos.
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
          <h2 style={{ margin: 0 }}>Bestsellers with an Amazon-style shell</h2>
        </div>
        <div className="filter-row">
          {["Prime-style", "Bestsellers", "New arrivals", "Bundles", "Under $25"].map((filter) => (
            <button key={filter} className="filter-chip">
              {filter}
            </button>
          ))}
        </div>
      </div>

      <div className="catalog-grid">
        {catalog.map((product) => (
          <article className="product-card" key={product.id}>
            {product.badge && <div className="badge">{product.badge}</div>}
            <div className="product-thumb">{product.tagline}</div>
            <h3 style={{ margin: "0.25rem 0 0" }}>{product.name}</h3>
            <p className="muted" style={{ margin: 0 }}>
              {product.description}
            </p>
            <div className="rating">
              <span>{"★".repeat(5)}</span>
              <span>{product.rating.toFixed(1)}</span>
              <span className="muted">({product.reviews})</span>
            </div>
            <p className="price">
              USD <span style={{ fontSize: "1.1rem" }}>{product.price.toFixed(2)}</span>
            </p>
            <div className="delivery">{product.delivery}</div>
            <p className="muted" style={{ margin: 0 }}>
              Eligible for Prime-style perks & easy returns.
            </p>
            <div className="actions">
              <button className="button full">Add to Cart</button>
              <button className="button ghost full">Save</button>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
