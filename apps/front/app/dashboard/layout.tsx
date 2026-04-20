"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";

const navItems = [
  { label: "Overview", href: "/dashboard", icon: "⊞", roles: ["ADMIN", "ACCOUNTS", "SALES"] },
  { label: "Sales", href: "/dashboard/sales", icon: "📈", roles: ["ADMIN", "ACCOUNTS"] },
  { label: "Orders", href: "/dashboard/orders", icon: "🧾", roles: ["ADMIN", "ACCOUNTS", "SALES"] },
  { label: "POS", href: "/pos", icon: "🖥", roles: ["ADMIN", "SALES"] },
  { label: "Customers", href: "/dashboard/customers", icon: "👥", roles: ["ADMIN", "ACCOUNTS"] },
  { label: "Products", href: "/dashboard/products", icon: "📦", roles: ["ADMIN", "ACCOUNTS"] },
  { label: "Inventory", href: "/dashboard/inventory", icon: "🗃", roles: ["ADMIN", "ACCOUNTS"] },
  { label: "Purchases", href: "/dashboard/purchases", icon: "🛒", roles: ["ADMIN", "ACCOUNTS"] },
  { label: "Banking", href: "/dashboard/banking", icon: "🏦", roles: ["ADMIN", "ACCOUNTS"] },
  { label: "AI Alerts", href: "/dashboard/ai", icon: "✦", roles: ["ADMIN"] },
  { label: "Homepage", href: "/dashboard/homepage", icon: "🏠", roles: ["ADMIN"] },
  { label: "Tags", href: "/dashboard/tags", icon: "🏷", roles: ["ADMIN"] },
  { label: "Clocking", href: "/dashboard/clocking", icon: "🕐", roles: ["ADMIN", "ACCOUNTS", "SALES"] },
  { label: "Mail", href: "/dashboard/mail", icon: "✉", roles: ["ADMIN"] },
  { label: "Admin", href: "/dashboard/admin", icon: "⚙", roles: ["ADMIN"] },
];

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const [role, setRole] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    const savedRole = localStorage.getItem("mwalimu_role");
    const token = localStorage.getItem("mwalimu_token");
    if (!token) {
      router.push("/sign-in");
      return;
    }
    setRole(savedRole);
  }, [router]);

  const visibleItems = navItems.filter((item) => !role || item.roles.includes(role));

  return (
    <div className="dash-shell">
      <aside className={`dash-sidebar ${sidebarOpen ? "open" : ""}`}>
        <div className="dash-sidebar-head">
          <span className="dash-brand">Dashboard</span>
          <button className="dash-close-btn" onClick={() => setSidebarOpen(false)} aria-label="Close menu">✕</button>
        </div>
        <nav className="dash-nav">
          {visibleItems.map((item) => (
            <a
              key={item.href}
              href={item.href}
              className={`dash-nav-item ${pathname === item.href ? "active" : ""}`}
              onClick={() => setSidebarOpen(false)}
            >
              <span className="dash-nav-icon">{item.icon}</span>
              {item.label}
            </a>
          ))}
        </nav>
        <div className="dash-sidebar-foot">
          <a href="/" className="dash-nav-item">
            <span className="dash-nav-icon">←</span>
            Back to Store
          </a>
        </div>
      </aside>

      <div className={`dash-backdrop ${sidebarOpen ? "open" : ""}`} onClick={() => setSidebarOpen(false)} />

      <div className="dash-body">
        <header className="dash-topbar">
          <button className="dash-menu-btn" onClick={() => setSidebarOpen(true)} aria-label="Open menu">
            <span className="menu-icon" />
          </button>
          <span className="dash-topbar-title">
            {visibleItems.find((i) => i.href === pathname)?.label ?? "Dashboard"}
          </span>
          <div className="dash-topbar-right">
            <span className="dash-role-badge">{role ?? "Staff"}</span>
          </div>
        </header>
        <main className="dash-content">{children}</main>
      </div>
    </div>
  );
}
