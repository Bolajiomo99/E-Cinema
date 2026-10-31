import { NextResponse } from "next/server";
import { CheckoutPaymentIntent } from "@paypal/paypal-server-sdk";
import type { OrderRequest } from "@paypal/paypal-server-sdk";
import { randomUUID } from "node:crypto";
import { findShowtime } from "@/lib/catalog";
import { paypalError, paypalOrders } from "@/lib/paypal";
import { cookies } from "next/headers";
import { AdultOnlyError, apiEnabled, attachOrder, holdSeats, SoldOutError } from "@/lib/api";
import { accountApi, SESSION_COOKIE } from "@/lib/auth";
import { quote } from "@/lib/ticket-quote";

// Creates a PayPal order for one ticket. The price always comes from the server catalog.
export async function POST(req: Request) {
  const { showtimeId } = (await req.json().catch(() => ({}))) as { showtimeId?: string };
  const showtime = showtimeId ? findShowtime(showtimeId) : undefined;
  if (!showtime) return NextResponse.json({ error: "Unknown showtime" }, { status: 400 });
  // Tickets belong to an account (one person, one seat), so buyers sign in first.
  const session = (await cookies()).get(SESSION_COOKIE)?.value;
  if (apiEnabled && !session) return NextResponse.json({ error: "Sign in to buy a seat", signIn: true }, { status: 401 });

  // Member discount and VAT follow the buyer's plan and home country.
  const prof = session ? await accountApi("GET", "/v1/me/profile", undefined, session).catch(() => null) : null;
  const q = quote(showtime, prof?.status === 200 ? (prof.body as { plan?: string; planStatus?: string; country?: string }) : undefined);
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
          { name: `${showtime.film} · premiere seat`, quantity: "1", unitAmount: { currencyCode: cur, value: q.seat }, ...(Number(q.vat) ? { tax: { currencyCode: cur, value: q.vat } } : {}) },
          ...(Number(q.late) ? [{ name: "Late entry (after the first 15 minutes)", quantity: "1", unitAmount: { currencyCode: cur, value: q.late }, ...(Number(q.vat) ? { tax: { currencyCode: cur, value: "0.00" } } : {}) }] : []),
        ],
      },
    ],
  };

  try {
    const hold = await holdSeats(showtime.id, 1, randomUUID(), session);
    const { result } = await paypalOrders().createOrder({ body, paypalRequestId: randomUUID(), prefer: "return=minimal" });
    if (hold && result.id) await attachOrder(hold.id, result.id);
    return NextResponse.json({ orderId: result.id });
  } catch (err) {
    if (err instanceof SoldOutError) return NextResponse.json({ error: "Sold out" }, { status: 409 });
    if (err instanceof AdultOnlyError) return NextResponse.json({ error: "This screening is for verified adults. Finish the face and ID check in your account first.", verify: true }, { status: 403 });
    if (err instanceof Error && / 401$/.test(err.message)) return NextResponse.json({ error: "Sign in to buy a seat", signIn: true }, { status: 401 });
    return paypalError(err);
  }
}
