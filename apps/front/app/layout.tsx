import "./globals.css";
import type { ReactNode } from "react";
import { Suspense } from "react";
import { NavBar } from "./NavBar";

export const metadata = {
  title: "Mwalimu Cosmetics",
  description: "Ecommerce and retail operations for Mwalimu Cosmetics"
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-sand text-slate-900">
        <Suspense fallback={null}>
          <NavBar />
        </Suspense>
        <main className="page-shell">{children}</main>
      </body>
    </html>
  );
}
