const cards = [
  {
    title: "Sales Overview",
    body: "View online vs counter sales, gross margin, and daily performance.",
    action: "View sales dashboard"
  },
  {
    title: "Purchases & Suppliers",
    body: "Record supplier bills, update stock, and track creditor balances.",
    action: "Record a purchase"
  },
  {
    title: "Bank Reconciliation",
    body: "Import bank statements and reconcile to customer payments or cash in hand.",
    action: "Start reconciliation"
  },
  {
    title: "AI Alerts",
    body: "Price gaps, slow movers, and seasonal stocking recommendations ready for approval.",
    action: "Review recommendations"
  },
  {
    title: "Catalog Management",
    body: "Add/update products, pricing, cost, and visibility for the storefront and POS.",
    action: "Manage products"
  },
  {
    title: "Staff Clocking",
    body: "Biometric or WebAuthn clock-ins for attendance and payroll exports.",
    action: "Open timesheets"
  }
];

export default function DashboardPage() {
  return (
    <div className="grid grid-cols-3 gap-6">
      {cards.map((card) => (
        <article key={card.title} className="card">
          <h3>{card.title}</h3>
          <p className="muted">{card.body}</p>
          <button className="button" style={{ marginTop: "0.8rem" }}>
            {card.action}
          </button>
        </article>
      ))}
    </div>
  );
}
