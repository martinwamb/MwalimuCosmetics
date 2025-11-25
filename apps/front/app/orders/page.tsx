export default function OrdersPage() {
  return (
    <div className="card">
      <h2 style={{ marginTop: 0 }}>Your orders</h2>
      <p className="muted">
        Sign in to see past orders, delivery statuses, and quick reorders. The top bar keeps Home, language, sign in,
        orders, and cart in view.
      </p>
      <a href="/sign-in" className="text-link" style={{ marginTop: "0.5rem", display: "inline-block" }}>
        Go to sign in
      </a>
    </div>
  );
}
