"use client";

import { usePathname } from "next/navigation";
import Image from "next/image";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

export function NavBar() {
  const pathname = usePathname();
  const [token, setToken] = useState<string | null>(null);
  const [logoOk, setLogoOk] = useState(true);
  const router = useRouter();

  useEffect(() => {
    try {
      setToken(localStorage.getItem("mwalimu_token")?.trim() || null);
    } catch {
      // ignore
    }
  }, []);

  // Dashboard has its own topbar — don't double-render a header
  if (pathname?.startsWith("/dashboard")) return null;

  function handleSignOut() {
    try {
      localStorage.removeItem("mwalimu_token");
      localStorage.removeItem("mwalimu_role");
      localStorage.removeItem("mwalimu_email");
    } catch {
      // ignore
    }
    setToken(null);
    router.push("/sign-in");
  }

  return (
    <header className="simple-header">
      <a href="/" className="simple-brand">
        {logoOk ? (
          <Image
            src="/logo.png?v=3"
            alt="Mwalimu Cosmetics"
            width={96}
            height={32}
            priority
            onError={() => setLogoOk(false)}
            style={{ height: 28, width: "auto", objectFit: "contain", background: "#fff", padding: "2px 6px", borderRadius: 6 }}
          />
        ) : (
          "Mwalimu Cosmetics"
        )}
      </a>
      <nav className="simple-nav">
        {token ? (
          <>
            <a href="/dashboard">Dashboard</a>
            <button type="button" onClick={handleSignOut}>Sign out</button>
          </>
        ) : (
          <a href="/sign-in">Staff Login</a>
        )}
      </nav>
    </header>
  );
}
