export default function POSLayout({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ height: "100vh", overflow: "hidden", display: "flex", flexDirection: "column" }}>
      <div style={{
        background: "var(--night)",
        color: "#f6f7f8",
        padding: "0 1rem",
        height: "60px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        flexShrink: 0,
        borderBottom: "1px solid rgba(255,255,255,0.1)"
      }}>
        <a href="/dashboard" style={{ color: "rgba(246,247,248,0.7)", fontWeight: 700, fontSize: "0.85rem" }}>← Dashboard</a>
        <span style={{ fontWeight: 800, color: "var(--gold)", letterSpacing: "-0.01em" }}>Mwalimu POS</span>
        <a href="/" style={{ color: "rgba(246,247,248,0.7)", fontWeight: 700, fontSize: "0.85rem" }}>Store →</a>
      </div>
      <div style={{ flex: 1, overflow: "hidden" }}>
        {children}
      </div>
    </div>
  );
}
