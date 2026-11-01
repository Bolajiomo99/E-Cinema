"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

// The cart icon in the top nav, with how many items are in it.
export default function CartLink({ initial }: { initial?: number }) {
  const [n, setN] = useState(initial ?? 0);
  useEffect(() => {
    if (initial === undefined) fetch("/api/store/cart").then((r) => (r.ok ? r.json() : null)).then((q) => q && setN(q.count ?? 0)).catch(() => undefined);
    const on = (e: Event) => setN((e as CustomEvent<number>).detail);
    window.addEventListener("ec-cart", on);
    return () => window.removeEventListener("ec-cart", on);
  }, [initial]);
  return (
    <Link href="/shop/cart" className="hm-icon sh-cartlink" aria-label={`Cart, ${n} item${n === 1 ? "" : "s"}`}>
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><circle cx="9" cy="21" r="1" /><circle cx="20" cy="21" r="1" /><path d="M1 1h4l2.7 13.4a2 2 0 0 0 2 1.6h9.7a2 2 0 0 0 2-1.6L23 6H6" /></svg>
      {n > 0 && <span className="sh-badge">{n > 99 ? "99+" : n}</span>}
    </Link>
  );
}
