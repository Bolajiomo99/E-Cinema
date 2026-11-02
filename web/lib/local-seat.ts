import "server-only";
import { randomUUID } from "node:crypto";
import { AdultOnlyError, attachOrder, holdSeats, markPaid, myTickets, releaseHold, SoldOutError } from "@/lib/api";
import { accountApi, currentAccount } from "@/lib/auth";
import { findShowtime } from "@/lib/catalog";
import { kidsGate } from "@/lib/family";
import { convert } from "@/lib/fx";
import { covers, newReference, providerReady, startPayment, verifyPayment, type Provider } from "@/lib/local-pay";
import { quote, salesOver } from "@/lib/ticket-quote";

const site = () => (process.env.WEB_URL || "https://e-cinema.net").replace(/\/$/, "");

// Holds a seat and opens the provider's checkout for it. Returns the page to send the buyer to.
export async function startSeat(p: Provider, session: string, showtimeId: string, quality?: string): Promise<{ status: number; body: Record<string, unknown> }> {
  if (!providerReady(p)) return { status: 503, body: { error: "This payment method is not switched on yet" } };
  const s = findShowtime(showtimeId);
  if (!s) return { status: 400, body: { error: "Unknown showtime" } };
  if (s.adult) return { status: 409, body: { error: "Adult titles unlock in four stages", unlock: `/unlock/${s.id}` } };
  const gate = await kidsGate(session, s.rating ?? "");
  if (gate) return { status: gate.status, body: (await gate.json()) as Record<string, unknown> };
  const me = await currentAccount();
  if (!me) return { status: 401, body: { error: "Sign in to buy a seat", signIn: true } };
  const prof = await accountApi("GET", "/v1/me/profile", undefined, session).catch(() => null);
  const q = quote(s, prof?.status === 200 ? (prof.body as { plan?: string; planStatus?: string; country?: string }) : undefined, Date.now(), quality);
  if (salesOver(q.phase)) return { status: 410, body: { error: q.phase === "ended" ? "This premiere has ended" : "Doors have closed for this premiere" } };
  // A studio that set a naira price (Figma 35:514) charges it; quality, late entry, member
  // discount and VAT scale it the same way they scale the dollar price.
  const ng = s.local?.NG?.currency === "NGN" ? s.local.NG.minor / 100 : 0;
  const naira = ng ? ng * (Number(q.total) / Number(s.price.value)) : await convert(Number(q.total), q.currency, "NGN");
  if (!naira) return { status: 503, body: { error: "We could not get today's naira rate. Try PayPal or try again soon." } };
  const amountKobo = Math.ceil(naira) * 100; // whole naira, rounded up
  const net = Math.round((Number(q.seat) + Number(q.late) - Number(q.discount)) * 100);
  try {
    const stale = (await myTickets(session).catch(() => [])).filter((t) => t.showtimeId === s.id && t.status === "held");
    await Promise.all(stale.map((t) => releaseHold(session, t.holdId).catch(() => undefined)));
    const hold = await holdSeats(s.id, 1, randomUUID(), session, q.quality);
    if (!hold) return { status: 503, body: { error: "Seats are not available here" } };
    const reference = newReference(p);
    await attachOrder(hold.id, reference, net);
    try {
      const started = await startPayment(p, {
        reference,
        amountKobo,
        email: me.email,
        name: me.name || "E-Cinema member",
        title: `Ticket: ${s.film}`,
        returnUrl: `${site()}/api/pay/${p}/return`,
        meta: { holdId: hold.id, showtimeId: s.id, quality: q.quality },
      });
      return { status: 200, body: { url: started.url, reference } };
    } catch (e) {
      await releaseHold(session, hold.id).catch(() => undefined);
      const name = p === "paystack" ? "Paystack" : "Flutterwave";
      const msg = e instanceof Error && !/fetch failed|timeout|aborted/i.test(e.message) ? e.message : `${name} is not answering right now. Try again, or pay with PayPal.`;
      console.error(`${name} start failed`, e instanceof Error ? e.message : e);
      return { status: 502, body: { error: msg } };
    }
  } catch (err) {
    if (err instanceof SoldOutError) return { status: 409, body: { error: "Sold out" } };
    if (err instanceof AdultOnlyError) return { status: 403, body: { error: "Verified adults only" } };
    throw err;
  }
}

// Confirms a payment with the provider and marks the seat paid. Safe to call twice
// (the return page and the webhook both do).
export async function finishSeat(p: Provider, reference: string): Promise<{ paid: boolean; showtimeId: string; why?: string }> {
  const v = await verifyPayment(p, reference);
  const showtimeId = v.meta.showtimeId ?? "";
  if (!covers(v)) return { paid: false, showtimeId, why: v.why ?? "The payment did not cover the seat" };
  await markPaid(reference, `${reference}~${v.txId}`);
  return { paid: true, showtimeId };
}
