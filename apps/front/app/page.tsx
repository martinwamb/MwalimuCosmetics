export default function HomePage() {
  return (
    <div className="coming-soon-root">
      <div className="coming-soon-card">
        <div className="coming-soon-brand">Mwalimu Cosmetics</div>
        <h1 className="coming-soon-title">Something beautiful<br />is coming soon</h1>
        <p className="coming-soon-body">
          We are working hard to bring you a new online experience. Our store will be live shortly — check back soon.
        </p>
        <div className="coming-soon-divider" />
        <p className="coming-soon-staff-label">Are you a staff member?</p>
        <a href="/sign-in" className="button full" style={{ display: "block", textAlign: "center", marginTop: "0.5rem" }}>
          Staff Login
        </a>
      </div>
    </div>
  );
}
