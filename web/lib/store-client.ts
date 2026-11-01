"use client";
import type { Quote } from "@/lib/store-types";

// Browser helpers for the store API. Every cart change announces the new count so the cart
// icon in the top nav stays right without a reload.
export async function store<T>(path: string, method = "GET", body?: unknown): Promise<{ ok: boolean; status: number; data: T & { error?: string; signIn?: boolean } }> {
  const r = await fetch(`/api/store/${path}`, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await r.json().catch(() => ({}));
  if (r.status === 401 && data?.signIn) window.location.assign(`/signin?next=${encodeURIComponent(location.pathname + location.search)}`);
  return { ok: r.ok, status: r.status, data };
}

export function announce(q: Quote) {
  window.dispatchEvent(new CustomEvent("ec-cart", { detail: q.count }));
}

export async function setCart(productId: string, variant: string, qty: number, add = false) {
  const r = await store<Quote>("cart", "PUT", { productId, variant, qty, add });
  if (r.ok) announce(r.data);
  return r;
}
