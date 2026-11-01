import "server-only";
import { accountApi } from "@/lib/auth";
import { findShowtime, type Showtime } from "@/lib/catalog";
import { emailEnabled, sendGift, sendGiftToForward } from "@/lib/email";
import { priceOf, vipSeatPrice } from "@/lib/plans";
import { phaseOf, quote } from "@/lib/ticket-quote";

// Gift a seat (Figma 94:1398). Prices are worked out here on the server, never taken from the browser.
export type GiftKind = "seat" | "pro1" | "vip3" | "credit";
export const CREDIT_CHIPS = [500, 1000, 2500];
export const CREDIT_MIN = 100;
export const CREDIT_MAX = 50000;
export const KIND_LABEL: Record<GiftKind, string> = { seat: "A premiere seat", pro1: "1 month of Pro", vip3: "3 months of VIP", credit: "Credit" };

export type Gift = {
  id: string; code?: string; kind: GiftKind; showtimeId?: string; amountCents: number; currency: string; name: string;
  email?: string; phone?: string; message: string; deliverAt: string; deliveredAt?: string; status: "pending" | "paid" | "redeemed";
  redeemedAt?: string; giverName?: string; createdAt: string;
};

// Seats that can be gifted: not ended, not 18+ (the unlock needs the viewer's own PIN and ID).
export const giftable = (s: Showtime, now = Date.now()) => !s.adult && phaseOf(s, now) !== "ended";

export function giftPrice(kind: GiftKind, opts: { showtime?: Showtime; amountCents?: number }): { cents: number; currency: string } | null {
  if (kind === "pro1") return { cents: Math.round(priceOf("pro", "USD") * 100), currency: "USD" };
  if (kind === "vip3") return { cents: Math.round(vipSeatPrice(10, "USD") * 300), currency: "USD" };
  if (kind === "credit") {
    const c = Math.round(opts.amountCents ?? 0);
    return c >= CREDIT_MIN && c <= CREDIT_MAX ? { cents: c, currency: "USD" } : null;
  }
  const s = opts.showtime;
  if (!s || !giftable(s)) return null;
  // A gifted seat is the plain HD seat at today's price (pre-order savings apply; no member discount or VAT for the giver).
  const q = quote(s, undefined);
  return { cents: Math.round((Number(q.seat) + Number(q.late)) * 100), currency: q.currency };
}

export async function giftByCode(code: string): Promise<Gift | null> {
  if (!/^ECG-[A-Z0-9]{4}-[A-Z0-9]{4}$/i.test(code)) return null;
  const r = await accountApi("GET", `/v1/gifts/${encodeURIComponent(code.toUpperCase())}`).catch(() => null);
  return r?.status === 200 ? (r.body as Gift) : null;
}

export async function sentGifts(session: string): Promise<Gift[]> {
  const r = await accountApi("GET", "/v1/me/gifts", undefined, session).catch(() => null);
  return r?.status === 200 ? ((r.body as Gift[]) ?? []) : [];
}

export async function creditBalance(session: string): Promise<number> {
  const r = await accountApi("GET", "/v1/me/credit", undefined, session).catch(() => null);
  return r?.status === 200 ? ((r.body as { cents: number }).cents ?? 0) : 0;
}

export function describeGift(g: Pick<Gift, "kind" | "showtimeId" | "amountCents" | "currency">) {
  if (g.kind === "seat") return `a seat for ${findShowtime(g.showtimeId ?? "")?.film ?? "a premiere"}`;
  if (g.kind === "credit") return `${g.currency === "USD" ? "$" : `${g.currency} `}${(g.amountCents / 100).toFixed(2)} of E-Cinema credit`;
  return KIND_LABEL[g.kind].replace(/^1/, "one").replace(/^3/, "three");
}

// Hands out gifts whose delivery time has come. The API returns each one exactly once, so this is safe to call often;
// the throttle only keeps page loads from asking every time.
let last = 0;
export async function sweepGifts(force = false) {
  if (!force && Date.now() - last < 60_000) return;
  last = Date.now();
  const r = await accountApi("POST", "/v1/gifts/due", {}).catch(() => null);
  if (r?.status !== 200) return;
  const due = ((r.body as (Gift & { giverEmail?: string })[]) ?? []);
  await Promise.allSettled(due.map(async (g) => {
    const what = describeGift(g);
    if (!emailEnabled) {
      if (process.env.E2E_LOG_CODES) console.log(`[e2e] gift ${g.code} for ${g.email || g.phone}`);
      return;
    }
    if (g.email) return sendGift(g.email, g.name, g.giverName ?? "A friend", what, g.message, g.code!);
    // WhatsApp delivery is still being approved, so the giver gets the link to pass on.
    if (g.giverEmail) return sendGiftToForward(g.giverEmail, g.name, g.phone ?? "", what, g.code!);
  }));
}
