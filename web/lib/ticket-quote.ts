import { endsAt, type Showtime } from "@/lib/catalog";
import { priceOf, vatRate } from "@/lib/plans";

// Paid members get 10% off premiere seats (Figma "Web / Checkout", 18:533).
export const MEMBER_DISCOUNT = 0.1;
// Studios can switch on a student price (Studio / Premieres, Figma 35:514): Student Pro members,
// who are verified students, get this off instead of the member discount.
export const STUDENT_DISCOUNT = 0.3;
const MEMBER_PLANS = new Set(["student", "pro", "vip", "enterprise"]);

export type Quality = "hd" | "4k" | "vr";
// How you watch (Figma "Web / Pre-order", 52:958). 4K and VR cost more; only titles mastered for
// them offer them.
export const QUALITIES: { id: Quality; name: string; sub: string; factor: number }[] = [
  { id: "hd", name: "1080p Full HD", sub: "Phones, laptops, most TVs", factor: 1 },
  { id: "4k", name: "4K HDR + Dolby Atmos", sub: "Big screens and sound systems", factor: 1.3 },
  { id: "vr", name: "VR cinema seat", sub: "Front-row seat in a virtual cinema · Quest, Pico, Vision Pro, E‑Cinema headset", factor: 1.5 },
];
export function qualitiesFor(s: Showtime) {
  return QUALITIES.filter((x) => x.id === "hd" || (x.id === "4k" && /4K/.test(s.format ?? "")) || (x.id === "vr" && s.vr));
}
export const asQuality = (s: Showtime, v?: string | null): Quality => (qualitiesFor(s).find((x) => x.id === v)?.id ?? "hd");

export type Quote = { currency: string; quality: Quality; full: string; preorderSave: number; seat: string; late: string; discount: string; vat: string; vatRate: number; total: string; member: string | null; student: boolean; phase: Phase };

// Late entry (product brief, 2026-10-14): the normal price until 15 minutes in, double after,
// and the doors close 30 minutes before the end (Figma 118:1379). "closed" means the film is still
// playing for people inside, but no new seats are sold. The API enforces the same times.
export const LATE_GRACE_MIN = 15;
export const DOORS_CLOSE_MIN = 30;
export type Phase = "before" | "grace" | "late" | "closed" | "ended";
export const doorsCloseAt = (s: Showtime) => Date.parse(s.startsAt) + Math.max((s.runtimeMin ?? 120) - DOORS_CLOSE_MIN, LATE_GRACE_MIN) * 60_000;
export function phaseOf(s: Showtime, now = Date.now()): Phase {
  const start = Date.parse(s.startsAt);
  if (now < start) return "before";
  if (now >= endsAt(s)) return "ended";
  if (now >= doorsCloseAt(s)) return "closed";
  return now < start + LATE_GRACE_MIN * 60_000 ? "grace" : "late";
}
// No new seats once the doors have closed or the film has ended.
export const salesOver = (p: Phase) => p === "closed" || p === "ended";

// Pre-orders (Figma "Web / Coming soon", 52:808): the price rises in 3 stages as release gets
// closer. Full early saving until 14 days out, half of it until 3 days out, then the release price.
export const PREORDER_STAGES = [{ untilDays: 14, share: 1 }, { untilDays: 3, share: 0.5 }];
export function preorderSave(s: Showtime, now = Date.now()): number {
  if (!s.earlySave) return 0;
  const days = (Date.parse(s.startsAt) - now) / 86_400_000;
  const stage = PREORDER_STAGES.find((x) => days > x.untilDays);
  return stage ? Math.round(s.earlySave * stage.share) : 0;
}
// When the current pre-order price ends, so the page can say when it goes up.
export function nextPriceRise(s: Showtime, now = Date.now()): number | null {
  if (!preorderSave(s, now)) return null;
  const start = Date.parse(s.startsAt);
  const at = PREORDER_STAGES.map((x) => start - x.untilDays * 86_400_000).find((t) => t > now);
  return at ?? null;
}

const cents = (v: number) => Math.round(v * 100);
const fmt = (c: number) => (c / 100).toFixed(2);

// The one place a ticket price is worked out, used by the checkout page and the PayPal order,
// so what the viewer sees is exactly what PayPal charges.
// Adult titles (Figma 28:839) unlock in four equal payments, each 10% above the Pro upgrade.
export const ADULT_STAGES = 4;
export const ADULT_STAGE_CENTS = Math.round(priceOf("pro", "USD") * 110);

export function quote(s: Showtime, who?: { plan?: string; planStatus?: string; country?: string }, now = Date.now(), quality?: string): Quote {
  const qual = s.adult ? "hd" : asQuality(s, quality);
  const full = s.adult ? ADULT_STAGE_CENTS : Math.round(cents(Number(s.price.value)) * QUALITIES.find((x) => x.id === qual)!.factor);
  const save = s.adult ? 0 : preorderSave(s, now);
  const seat = Math.round(full * (1 - save / 100));
  const phase = phaseOf(s, now);
  const late = phase === "late" ? seat : 0;
  const member = !s.adult && who?.planStatus === "active" && who.plan && MEMBER_PLANS.has(who.plan) ? who.plan : null;
  const student = member === "student" && Boolean(s.studentPrice);
  const discount = member ? Math.round(seat * (student ? STUDENT_DISCOUNT : MEMBER_DISCOUNT)) : 0;
  const rate = vatRate(who?.country);
  const vat = Math.round((seat + late - discount) * rate);
  return { currency: s.price.currency, quality: qual, full: fmt(full), preorderSave: save, seat: fmt(seat), late: fmt(late), discount: fmt(discount), vat: fmt(vat), vatRate: rate, total: fmt(seat + late - discount + vat), member, student, phase };
}

// The price at each pre-order stage, for the "Price goes up as release gets closer" strip.
export function priceStages(s: Showtime, quality?: string, now = Date.now()) {
  const start = Date.parse(s.startsAt);
  const cuts = PREORDER_STAGES.map((x) => start - x.untilDays * 86_400_000).filter((t) => t > now);
  const times = [now, ...cuts];
  const out: { label: string; seat: string; currency: string; until: number }[] = [];
  times.forEach((t, i) => {
    const q = quote(s, undefined, Math.min(t, start - 1), quality);
    const until = times[i + 1] ?? start;
    if (out.length && out[out.length - 1].seat === q.seat) out[out.length - 1].until = until;
    else out.push({ label: "", seat: q.seat, currency: q.currency, until });
  });
  return out.map((x, i) => ({ ...x, label: i === 0 ? "NOW" : i === out.length - 1 ? "RELEASE" : `STAGE ${i + 1}` }));
}
