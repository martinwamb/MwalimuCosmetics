"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";

const apiBase = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

const navItems = [
  { label: "Overview",   href: "/dashboard",            icon: "◈", roles: ["ADMIN","ACCOUNTS","SALES"] },
  { label: "POS",        href: "/dashboard/pos",        icon: "⊡", roles: ["ADMIN","SALES"] },
  { label: "Sales",      href: "/dashboard/sales",      icon: "↗", roles: ["ADMIN","ACCOUNTS","SALES"] },
  { label: "Analytics",  href: "/dashboard/analytics",  icon: "▦", roles: ["ADMIN","ACCOUNTS"] },
  { label: "Stock",      href: "/dashboard/stock",      icon: "⊞", roles: ["ADMIN","ACCOUNTS"] },
  { label: "Tickets",    href: "/dashboard/tickets",    icon: "◎", roles: ["ADMIN","ACCOUNTS","SALES","FRONTDESK"] },
  { label: "History",   href: "/dashboard/history",    icon: "◷", roles: ["ADMIN","ACCOUNTS"] },
  // ACCOUNTS is not a new permission here: /display/media and /uploads have
  // always allowed it, and only this menu pretended otherwise.
  { label: "Shop Screen", href: "/dashboard/screen",   icon: "▶", roles: ["ADMIN","ACCOUNTS","FRONTDESK"] },
  { label: "Staff",      href: "/dashboard/admin",     icon: "⚙", roles: ["ADMIN"] },
];

// This menu is a convenience, not a permission. Every one of these pages is
// guarded again at the API, which is the only place it counts - hiding a link
// stops nobody who can type a URL.

function friendlyRole(r: string | null) {
  if (r === "ADMIN") return "Admin";
  if (r === "ACCOUNTS") return "Accounts";
  if (r === "SALES") return "Sales";
  if (r === "FRONTDESK") return "Tickets & Screen";
  return r ?? "Staff";
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const [role, setRole]       = useState<string | null>(null);
  const [email, setEmail]     = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const pathname = usePathname();
  const router   = useRouter();

  useEffect(() => {
    const token = localStorage.getItem("mwalimu_token");
    if (!token) { router.push("/sign-in"); return; }
    setRole(localStorage.getItem("mwalimu_role"));
    setEmail(localStorage.getItem("mwalimu_email"));

    // Having a token is not the same as having a VALID one. They last seven
    // days, so a week after signing in the sidebar, the role badge and the
    // email all still render while every request behind them returns 401 —
    // and each page then reports that in its own words as its own failure.
    // "Could not load the photo list" is true, and completely misleading.
    //
    // A network error is deliberately NOT treated as an expired session: the
    // shop's internet drops, and signing staff out every time it does would be
    // its own kind of broken.
    fetch(`${apiBase}/auth/me`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => {
        if (r.status === 401) {
          ["mwalimu_token", "mwalimu_role", "mwalimu_email"].forEach(k => {
            try { localStorage.removeItem(k); } catch {}
          });
          router.push("/sign-in?expired=1");
        }
      })
      .catch(() => {});
  }, [router]);

  function signOut() {
    ["mwalimu_token","mwalimu_role","mwalimu_email"].forEach(k => {
      try { localStorage.removeItem(k); } catch {}
    });
    router.push("/sign-in");
  }

  const visible = navItems.filter(i => !role || i.roles.includes(role));

  return (
    <div className="dash-shell">
      {/* Sidebar */}
      <aside className={`dash-sidebar ${sidebarOpen ? "open" : ""}`}>
        <div className="dash-sidebar-head">
          <span className="dash-brand">Mwalimu</span>
          <button className="dash-close-btn" onClick={() => setSidebarOpen(false)}>✕</button>
        </div>
        <nav className="dash-nav">
          {visible.map(item => (
            <a key={item.href} href={item.href}
              className={`dash-nav-item ${pathname === item.href ? "active" : ""}`}
              onClick={() => setSidebarOpen(false)}>
              <span className="dash-nav-icon">{item.icon}</span>
              {item.label}
            </a>
          ))}
        </nav>
        <div className="dash-sidebar-foot">
          {email && <div style={{ padding: "0 0.75rem 0.5rem", fontSize: "0.78rem", color: "rgba(246,247,248,0.5)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{email}</div>}
          <button type="button" onClick={signOut}
            style={{ width:"100%", background:"none", border:"none", cursor:"pointer", fontFamily:"inherit" }}
            className="dash-nav-item">
            <span className="dash-nav-icon">→</span>Sign out
          </button>
        </div>
      </aside>

      <div className={`dash-backdrop ${sidebarOpen ? "open" : ""}`} onClick={() => setSidebarOpen(false)} />

      <div className="dash-body">
        <header className="dash-topbar">
          <button className="dash-menu-btn" onClick={() => setSidebarOpen(true)} aria-label="Open menu">
            <span className="menu-icon" />
          </button>
          <span className="dash-topbar-title">
            {visible.find(i => pathname.startsWith(i.href) && i.href !== "/dashboard")?.label
              ?? (pathname === "/dashboard" ? "Overview" : "Dashboard")}
          </span>
          <div className="dash-topbar-right">
            <span className="dash-role-badge">{friendlyRole(role)}</span>
          </div>
        </header>
        <main className="dash-content">{children}</main>
      </div>
    </div>
  );
}
