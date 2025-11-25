import "./globals.css";
import type { ReactNode } from "react";

export const metadata = {
  title: "Mwalimu Cosmetics",
  description: "Ecommerce and retail operations for Mwalimu Cosmetics"
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-sand text-slate-900">
        <header className="header">
          <div className="nav-primary">
            <a href="/" className="brand">
              Mwalimu Cosmetics
            </a>
            <div className="search">
              <select aria-label="Category">
                <option>All beauty</option>
                <option>Skin care</option>
                <option>Hair</option>
                <option>Makeup</option>
              </select>
              <input placeholder="Search Mwalimu favorites..." aria-label="Search" />
              <button aria-label="Search products">Search</button>
            </div>
            <nav className="nav-links nav-actions">
              <a href="/">Home</a>
              <div className="language-switch" aria-label="Language">
                <span>EN</span>
                <span className="divider">|</span>
                <span>KE</span>
              </div>
              <a href="/sign-in">Sign in</a>
              <a href="/orders">Orders</a>
              <a href="/cart">Cart</a>
            </nav>
          </div>
          <div className="nav-sub">
            <div className="nav-sub-inner">
              <span>Skin care</span>
              <span>Makeup</span>
              <span>Hair</span>
              <span>Fragrance</span>
              <span>Gifts & Kits</span>
            </div>
          </div>
        </header>
        <main className="page-shell">{children}</main>
      </body>
    </html>
  );
}
