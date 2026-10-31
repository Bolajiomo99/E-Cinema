import type { Showtime } from "@/lib/catalog";
import { vatRate } from "@/lib/plans";

// Paid members get 10% off premiere seats (Figma "Web / Checkout", 18:533).
export const MEMBER_DISCOUNT = 0.1;
const MEMBER_PLANS = new Set(["student", "pro", "vip", "enterprise"]);

export type Quote = { currency: string; seat: string; discount: string; vat: string; vatRate: number; total: string; member: string | null };

const cents = (v: number) => Math.round(v * 100);
const fmt = (c: number) => (c / 100).toFixed(2);

// The one place a ticket price is worked out, used by the checkout page and the PayPal order,
// so what the viewer sees is exactly what PayPal charges.
export function quote(s: Showtime, who?: { plan?: string; planStatus?: string; country?: string }): Quote {
  const seat = cents(Number(s.price.value));
  const member = who?.planStatus === "active" && who.plan && MEMBER_PLANS.has(who.plan) ? who.plan : null;
  const discount = member ? Math.round(seat * MEMBER_DISCOUNT) : 0;
  const rate = vatRate(who?.country);
  const vat = Math.round((seat - discount) * rate);
  return { currency: s.price.currency, seat: fmt(seat), discount: fmt(discount), vat: fmt(vat), vatRate: rate, total: fmt(seat - discount + vat), member };
}
