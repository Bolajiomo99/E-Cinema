import { endsAt, type Showtime } from "@/lib/catalog";
import { vatRate } from "@/lib/plans";

// Paid members get 10% off premiere seats (Figma "Web / Checkout", 18:533).
export const MEMBER_DISCOUNT = 0.1;
const MEMBER_PLANS = new Set(["student", "pro", "vip", "enterprise"]);

export type Quote = { currency: string; seat: string; late: string; discount: string; vat: string; vatRate: number; total: string; member: string | null; phase: Phase };

// Late entry (product brief, 2026-10-14): the normal price until 15 minutes in, double after,
// and no new seats once the film has ended.
export const LATE_GRACE_MIN = 15;
export type Phase = "before" | "grace" | "late" | "ended";
export function phaseOf(s: Showtime, now = Date.now()): Phase {
  const start = Date.parse(s.startsAt);
  if (now < start) return "before";
  if (now >= endsAt(s)) return "ended";
  return now < start + LATE_GRACE_MIN * 60_000 ? "grace" : "late";
}

const cents = (v: number) => Math.round(v * 100);
const fmt = (c: number) => (c / 100).toFixed(2);

// The one place a ticket price is worked out, used by the checkout page and the PayPal order,
// so what the viewer sees is exactly what PayPal charges.
export function quote(s: Showtime, who?: { plan?: string; planStatus?: string; country?: string }, now = Date.now()): Quote {
  const seat = cents(Number(s.price.value));
  const phase = phaseOf(s, now);
  const late = phase === "late" ? seat : 0;
  const member = who?.planStatus === "active" && who.plan && MEMBER_PLANS.has(who.plan) ? who.plan : null;
  const discount = member ? Math.round(seat * MEMBER_DISCOUNT) : 0;
  const rate = vatRate(who?.country);
  const vat = Math.round((seat + late - discount) * rate);
  return { currency: s.price.currency, seat: fmt(seat), late: fmt(late), discount: fmt(discount), vat: fmt(vat), vatRate: rate, total: fmt(seat + late - discount + vat), member, phase };
}
