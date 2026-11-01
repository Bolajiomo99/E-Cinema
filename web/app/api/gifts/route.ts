import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { CheckoutPaymentIntent } from "@paypal/paypal-server-sdk";
import type { OrderRequest } from "@paypal/paypal-server-sdk";
import { randomUUID } from "node:crypto";
import { attachOrder, holdSeats, releaseHold, SoldOutError } from "@/lib/api";
import { accountApi, SESSION_COOKIE } from "@/lib/auth";
import { findShowtime } from "@/lib/catalog";
import { describeGift, giftPrice, type GiftKind } from "@/lib/gifts";
import { paypalError, paypalOrders } from "@/lib/paypal";

// Starts a gift (Figma 94:1398): works out the price, holds the seat for a seat gift,
// creates the PayPal order and records the gift. Delivery happens once PayPal confirms payment.
export const dynamic = "force-dynamic";

const json = (status: number, body: unknown) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
const KINDS = new Set<GiftKind>(["seat", "pro1", "vip3", "credit"]);

function sameOrigin(req: NextRequest) {
  const origin = req.headers.get("origin");
  return !origin || origin === req.nextUrl.origin || new URL(origin).host === req.headers.get("host");
}

export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return json(403, { error: "forbidden" });
  const session = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!session) return json(401, { error: "Sign in to send a gift", signIn: true });
  const b = (await req.json().catch(() => ({}))) as { kind?: GiftKind; showtimeId?: string; amountCents?: number; name?: string; to?: string; message?: string; deliverAt?: string };
  if (!b.kind || !KINDS.has(b.kind)) return json(400, { error: "Choose what to give" });
  const name = (b.name ?? "").trim();
  const to = (b.to ?? "").trim();
  if (!name || name.length > 80) return json(400, { error: "Add their name" });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to) && !/^\+?[0-9 ()-]{7,20}$/.test(to)) return json(400, { error: "Add their email or WhatsApp number" });
  const message = (b.message ?? "").trim().slice(0, 280);
  const deliverAt = b.deliverAt ? new Date(b.deliverAt) : new Date();
  if (Number.isNaN(deliverAt.getTime()) || deliverAt.getTime() > Date.now() + 366 * 86_400_000) return json(400, { error: "Pick a delivery date within a year" });

  const show = b.kind === "seat" ? findShowtime(b.showtimeId ?? "") : undefined;
  if (b.kind === "seat" && show && deliverAt.getTime() >= Date.parse(show.startsAt)) return json(400, { error: "Deliver the seat before the premiere starts" });
  const price = giftPrice(b.kind, { showtime: show, amountCents: b.amountCents });
  if (!price) return json(400, { error: b.kind === "seat" ? "Pick a premiere that has not ended" : "Credit can be $1 to $500" });
  const value = (price.cents / 100).toFixed(2);
  const what = describeGift({ kind: b.kind, showtimeId: show?.id, amountCents: price.cents, currency: price.currency });

  const order: OrderRequest = {
    intent: CheckoutPaymentIntent.Capture,
    purchaseUnits: [{
      referenceId: `gift-${b.kind}`,
      description: `E-Cinema gift: ${what}`.slice(0, 127),
      customId: `gift:${b.kind}${show ? `:${show.id}` : ""}`.slice(0, 127),
      amount: { currencyCode: price.currency, value, breakdown: { itemTotal: { currencyCode: price.currency, value } } },
      items: [{ name: `Gift for ${name}: ${what}`.slice(0, 127), quantity: "1", unitAmount: { currencyCode: price.currency, value } }],
    }],
  };

  let holdId: string | undefined;
  try {
    // The gifted seat is held with no owner; whoever redeems the gift becomes its owner.
    if (show) holdId = (await holdSeats(show.id, 1, `gift-${randomUUID()}`, undefined, "hd"))?.id;
    const { result } = await paypalOrders().createOrder({ body: order, paypalRequestId: randomUUID(), prefer: "return=minimal" });
    if (!result.id) throw new Error("PayPal gave no order id");
    if (holdId) await attachOrder(holdId, result.id, price.cents);
    const g = await accountApi("POST", "/v1/gifts", {
      kind: b.kind, showtimeId: show?.id ?? "", amountCents: price.cents, currency: price.currency,
      name, to, message, deliverAt: deliverAt.toISOString(), holdId: holdId ?? "", orderId: result.id,
    }, session);
    if (g.status !== 201) {
      if (holdId) await releaseHold(session, holdId).catch(() => undefined);
      return json(g.status === 401 ? 401 : 400, { error: (g.body as { error?: string })?.error ?? "Could not start the gift" });
    }
    return json(200, { orderId: result.id });
  } catch (err) {
    if (err instanceof SoldOutError) return json(409, { error: "That premiere just sold out. Try another one or give credit." });
    return paypalError(err);
  }
}
