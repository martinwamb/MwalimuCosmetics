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
    delivery: "Same-day delivery",
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
          <div className="hero-eyebrow">Holiday-ready glow</div>
          <h1>Glow-worthy picks from Mwalimu Cosmetics</h1>
          <p className="muted">
            Rich butters, brightening serums, long-wear pigments, and thoughtful bundles that keep skin soft and color
            bold all season.
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
            Save favorites, reorder in one tap, check delivery statuses, and unlock staff consoles when you log in as
            team.
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
              <span>{"*".repeat(5)}</span>
              <span>{product.rating.toFixed(1)}</span>
              <span className="muted">({product.reviews})</span>
            </div>
            <p className="price">
              USD <span style={{ fontSize: "1.1rem" }}>{product.price.toFixed(2)}</span>
            </p>
            <div className="delivery">{product.delivery}</div>
            <p className="muted" style={{ margin: 0 }}>
              Eligible for express delivery and easy returns.
            </p>
            <div className="actions">
              <button className="button full">Add to Cart</button>
              <button className="button ghost full">Save</button>
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
