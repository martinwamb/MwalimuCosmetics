const quickActions = [
  "New counter sale",
  "Scan barcode",
  "Apply discount",
  "Print receipt",
  "Cash up shift",
  "Clock in/out"
];

export default function POSPage() {
  return (
    <div className="card">
      <h2 style={{ marginTop: 0 }}>POS Console</h2>
      <p className="muted">
        Fast entry for over-the-counter sales. Sends receipts to the TEP-300 SUE thermal printer with your logo and QR.
      </p>
      <div className="grid grid-cols-3 gap-6" style={{ marginTop: "1rem" }}>
        {quickActions.map((action) => (
          <div key={action} className="card" style={{ boxShadow: "none", borderStyle: "dashed" }}>
            <strong>{action}</strong>
            <p className="muted" style={{ marginTop: "0.35rem" }}>
              Tap to proceed
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
