"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";

const navItems = [
  { label: "Overview",   href: "/dashboard",        icon: "◈", roles: ["ADMIN","ACCOUNTS","SALES"] },
  { label: "POS",        href: "/dashboard/pos",    icon: "⊡", roles: ["ADMIN","SALES"] },
  { label: "Sales",      href: "/dashboard/sales",  icon: "↗", roles: ["ADMIN","ACCOUNTS","SALES"] },
  { label: "Stock",      href: "/dashboard/stock",   icon: "⊞", roles: ["ADMIN","ACCOUNTS"] },
  { label: "History",   href: "/dashboard/history", icon: "◷", roles: ["ADMIN","ACCOUNTS"] },
  { label: "Admin",      href: "/dashboard/admin",  icon: "⚙", roles: ["ADMIN"] },
];

function friendlyRole(r: string | null) {
  if (r === "ADMIN") return "Admin";
  if (r === "ACCOUNTS") return "Accounts";
  if (r === "SALES") return "Sales";
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
