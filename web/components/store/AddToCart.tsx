"use client";

import Link from "next/link";
import { useState } from "react";
import { setCart } from "@/lib/store-client";

// "Add to cart" on a product tile or page. Tiles add the first colour and size; the toast
// says which, with a link to change it on the product page.
export default function AddToCart({ productId, variant, label = "Add to cart", className = "sh-btn sec sm", then, signedIn }: {
  productId: string; variant: string; label?: string; className?: string; then?: "cart"; signedIn: boolean;
}) {
  const [state, setState] = useState<"idle" | "busy" | "added" | "error">("idle");
  const [err, setErr] = useState("");
  if (!signedIn) return <Link className={className} href={`/signin?next=${encodeURIComponent(`/shop/${productId}`)}`}>{label}</Link>;
  const add = async () => {
    setState("busy");
    const r = await setCart(productId, variant, 1, true);
    if (!r.ok) {
      setErr(r.data.error ?? "Could not add it");
      return setState("error");
    }
    if (then === "cart") return window.location.assign("/shop/cart");
    setState("added");
    setTimeout(() => setState("idle"), 4000);
  };
  return (
    <span className="sh-add">
      <button type="button" className={className} onClick={add} disabled={state === "busy"} aria-live="polite">
        {state === "busy" ? "Adding…" : state === "added" ? "Added ✓" : label}
      </button>
      {state === "added" && variant && <small className="sh-toast">{variant} · <Link href={`/shop/${productId}`}>change</Link> · <Link href="/shop/cart">cart</Link></small>}
      {state === "error" && <small className="sh-toast err" role="alert">{err}</small>}
    </span>
  );
}
