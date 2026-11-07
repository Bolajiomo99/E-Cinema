import "server-only";
import { switchOn } from "@/lib/platform";
import { NextResponse } from "next/server";
import { CheckoutPaymentIntent } from "@paypal/paypal-server-sdk";
import type { OrderRequest } from "@paypal/paypal-server-sdk";
import { randomUUID } from "node:crypto";
import type { Showtime } from "@/lib/catalog";
import { paypalError, paypalOrders } from "@/lib/paypal";
import { AdultOnlyError, RegionError, apiEnabled, attachOrder, holdSeats, myTickets, releaseHold, SoldOutError } from "@/lib/api";
import { accountApi } from "@/lib/auth";
import { quote } from "@/lib/ticket-quote";
import { kidsGate } from "@/lib/family";

// Creates a PayPal order for one seat. The price always comes from the server catalog.
// Used by checkout and, for adult titles, by stage 4 of the unlock.
export async function createSeatOrder(showtime: Showtime, session: string | undefined, quality?: string) {
  // Tickets belong to an account (one person, one seat), so buyers sign in first.
  if (apiEnabled && !session) return NextResponse.json({ error: "Sign in to buy a seat", signIn: true }, { status: 401 });
  if (!switchOn("pay.paypal")) return NextResponse.json({ error: "PayPal is switched off just now. Pick another way to pay." }, { status: 503 });
  const gate = await kidsGate(session, showtime.adult ? "18+" : (showtime.rating ?? ""));
  if (gate) return gate;

  // Member discount and VAT follow the buyer's plan and home country.
  const prof = session ? await accountApi("GET", "/v1/me/profile", undefined, session).catch(() => null) : null;
  const q = quote(showtime, prof?.status === 200 ? (prof.body as { plan?: string; planStatus?: string; country?: string }) : undefined, Date.now(), quality);
  const cur = q.currency;
  if (q.phase === "ended") return NextResponse.json({ error: "This premiere has ended" }, { status: 410 });
  const itemTotal = (Number(q.seat) + Number(q.late)).toFixed(2);
  const body: OrderRequest = {
    intent: CheckoutPaymentIntent.Capture,
    purchaseUnits: [
      {
        referenceId: showtime.id,
        description: `E-Cinema ticket: ${showtime.film}`,
        customId: showtime.id,
        amount: {
          currencyCode: cur,
          value: q.total,
          breakdown: {
            itemTotal: { currencyCode: cur, value: itemTotal },
            ...(Number(q.discount) ? { discount: { currencyCode: cur, value: q.discount } } : {}),
            ...(Number(q.vat) ? { taxTotal: { currencyCode: cur, value: q.vat } } : {}),
          },
        },
        items: [
          { name: showtime.adult ? `${showtime.film} · 18+ unlock stage 4 of 4 · access fee` : `${showtime.film} · premiere seat${q.quality === "hd" ? "" : q.quality === "4k" ? " · 4K HDR" : " · VR"}${q.preorderSave ? " · pre-order" : ""}`, quantity: "1", unitAmount: { currencyCode: cur, value: q.seat }, ...(Number(q.vat) ? { tax: { currencyCode: cur, value: q.vat } } : {}) },
          ...(Number(q.late) ? [{ name: "Late entry (after the first 15 minutes)", quantity: "1", unitAmount: { currencyCode: cur, value: q.late }, ...(Number(q.vat) ? { tax: { currencyCode: cur, value: "0.00" } } : {}) }] : []),
        ],
      },
    ],
  };

  try {
    // Paying again after a failed try gives back the earlier unpaid hold, so one viewer never blocks two seats.
    if (session) {
      const stale = (await myTickets(session).catch(() => [])).filter((t) => t.showtimeId === showtime.id && t.status === "held");
      await Promise.all(stale.map((t) => releaseHold(session, t.holdId).catch(() => undefined)));
    }
    const hold = await holdSeats(showtime.id, 1, randomUUID(), session, q.quality);
    const { result } = await paypalOrders().createOrder({ body, paypalRequestId: randomUUID(), prefer: "return=minimal" });
    if (hold && result.id) await attachOrder(hold.id, result.id, Math.round((Number(itemTotal) - Number(q.discount)) * 100));
    return NextResponse.json({ orderId: result.id });
  } catch (err) {
    if (err instanceof SoldOutError) return NextResponse.json({ error: "Sold out" }, { status: 409 });
    if (err instanceof RegionError) return NextResponse.json({ error: err.message }, { status: 451 });
    if (err instanceof AdultOnlyError) return NextResponse.json({ error: "This screening is for verified adults. Finish the face and ID check in your account first.", verify: true }, { status: 403 });
    if (err instanceof Error && / 401$/.test(err.message)) return NextResponse.json({ error: "Sign in to buy a seat", signIn: true }, { status: 401 });
    return paypalError(err);
  }
}
