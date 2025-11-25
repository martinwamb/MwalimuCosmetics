export default function CartPage() {
  return (
    <div className="card">
      <h2 style={{ marginTop: 0 }}>Cart</h2>
      <p className="muted">
        Add products from the storefront, then sign in to save your cart, apply delivery options, and check out.
      </p>
      <a href="/sign-in" className="text-link" style={{ marginTop: "0.5rem", display: "inline-block" }}>
        Go to sign in
      </a>
    </div>
  );
}
