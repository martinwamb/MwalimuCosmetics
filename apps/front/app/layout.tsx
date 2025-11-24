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
        <header className="border-b border-rose-200 bg-white/70 backdrop-blur">
          <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
            <div className="text-lg font-semibold tracking-tight">Mwalimu Cosmetics</div>
            <nav className="flex gap-4 text-sm">
              <a href="/" className="hover:text-rose-600">
                Shop
              </a>
              <a href="/dashboard" className="hover:text-rose-600">
                Admin
              </a>
              <a href="/pos" className="hover:text-rose-600">
                POS
              </a>
            </nav>
          </div>
        </header>
        <main className="mx-auto max-w-6xl px-6 py-8">{children}</main>
      </body>
    </html>
  );
}
