import "server-only";
import { switchOn } from "@/lib/platform";
import { accountApi } from "@/lib/auth";
import { convert } from "@/lib/fx";
import { currencyFor } from "@/lib/plans";
import type { Order, Pricing, Product, Quote, Review } from "@/lib/store-types";

// Server side of the E-Cinema store: reads from the Go shop API and works out the viewer's
// display currency and what PayPal will charge (PayPal cannot take naira).

export async function storeProducts(): Promise<Product[]> {
  const r = await accountApi("GET", "/v1/shop/products").catch(() => null);
  return r?.status === 200 ? (r.body as { products: Product[] }).products : [];
}

export async function storeProduct(id: string): Promise<{ product: Product; reviews: Review[] } | null> {
  if (!/^[a-z0-9-]{2,40}$/.test(id)) return null;
  const r = await accountApi("GET", `/v1/shop/products/${id}`).catch(() => null);
  return r?.status === 200 ? (r.body as { product: Product; reviews: Review[] }) : null;
}

export async function myQuote(session: string, country?: string): Promise<Quote | null> {
  const r = await accountApi("GET", `/v1/me/cart${country ? `?country=${country}` : ""}`, undefined, session).catch(() => null);
  if (r?.status !== 200) return null;
  const q = r.body as Quote;
  return { ...q, cod: q.cod && switchOn("pay.cod") };
}

export async function myOrders(session: string): Promise<{ orders: Order[]; reviewable: string[] }> {
  const r = await accountApi("GET", "/v1/me/orders", undefined, session).catch(() => null);
  return r?.status === 200 ? (r.body as { orders: Order[]; reviewable: string[] }) : { orders: [], reviewable: [] };
}

// pricing turns naira into the viewer's currency. If no rate is known, prices stay in naira.
export async function pricing(country?: string): Promise<Pricing> {
  const currency = currencyFor(country);
  if (currency === "NGN") return { currency, rate: 1 };
  const rate = await convert(1, "NGN", currency);
  return rate ? { currency, rate } : { currency: "NGN", rate: 1 };
}

// chargeFor is what PayPal charges for a naira total: US dollars from Nigeria, else the display currency.
export async function chargeFor(totalNgn: number, country?: string): Promise<{ currency: string; cents: number } | null> {
  const display = currencyFor(country);
  const currency = display === "NGN" ? "USD" : display;
  const rate = await convert(1, "NGN", currency);
  if (!rate) return null;
  return { currency, cents: Math.max(1, Math.round(totalNgn * rate * 100)) };
}

// Staff who run deliveries (comma-separated emails in STAFF_EMAILS).
export function isStaff(email?: string) {
  const list = (process.env.STAFF_EMAILS ?? "admin@e-cinema.net").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
  return Boolean(email && list.includes(email.toLowerCase()));
}
