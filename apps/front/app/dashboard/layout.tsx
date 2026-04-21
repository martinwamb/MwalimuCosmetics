"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();

  useEffect(() => {
    const token = localStorage.getItem("mwalimu_token")?.trim();
    if (!token) router.push("/sign-in");
  }, [router]);

  return <>{children}</>;
}
