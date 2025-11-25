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
              <input placeholder="Search Mwalimu like you do on Amazon..." aria-label="Search" />
              <button aria-label="Search products">Search</button>
            </div>
            <nav className="nav-links">
              <a href="/dashboard">Admin</a>
              <a href="/pos">POS</a>
              <a href="/">Orders</a>
            </nav>
          </div>
          <div className="nav-sub">
            <div className="nav-sub-inner">
              <span>Today's Deals</span>
              <span>Bundles</span>
              <span>Prime-style Delivery</span>
              <span>Customer Favorites</span>
              <span>Gifts & Kits</span>
            </div>
          </div>
        </header>
        <main className="page-shell">{children}</main>
      </body>
    </html>
  );
}
