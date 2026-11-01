import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { CheckoutPaymentIntent } from "@paypal/paypal-server-sdk";
import { randomUUID } from "node:crypto";
import { accountApi, SESSION_COOKIE } from "@/lib/auth";
import { findShowtime } from "@/lib/catalog";
import { keepPrice } from "@/lib/library";
import { paypalError, paypalOrders } from "@/lib/paypal";
import { json, sameOrigin } from "@/lib/room-gate";

// Buy a film to keep (Library 19:583). The Go API checks the seat and that the premiere ended
// before the order is linked; the capture webhook marks it paid.
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, { params }: { params: Promise<{ showtime: string }> }) {
  if (!sameOrigin(req)) return json(403, { error: "forbidden" });
  const { showtime } = await params;
  const s = findShowtime(showtime);
  if (!s) return json(404, { error: "Not found" });
  const session = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!session) return json(401, { error: "Sign in first", signIn: true });
  const b = (await req.json().catch(() => ({}))) as { quality?: string };
  const quality = b.quality === "4k" ? "4k" : "hd";
  // Ask the API first so a viewer without a seat never sees a PayPal window.
  const access = await accountApi("GET", `/v1/me/library/${encodeURIComponent(s.id)}`, undefined, session);
  if (access.status === 404) return json(403, { error: "Only people who watched the premiere can keep this film" });
  if (access.status === 200 && (access.body as { owned?: boolean }).owned) return json(409, { error: "You already own this film" });
  const cur = s.price.currency;
  const value = keepPrice(s.price.value, quality);
  try {
    const { result } = await paypalOrders().createOrder({
      paypalRequestId: randomUUID(),
      prefer: "return=minimal",
      body: {
        intent: CheckoutPaymentIntent.Capture,
        purchaseUnits: [{
          referenceId: `${s.id}:keep`,
          customId: `${s.id}:keep:${quality}`,
          description: `E-Cinema: keep ${s.film} (${quality.toUpperCase()})`,
          amount: { currencyCode: cur, value, breakdown: { itemTotal: { currencyCode: cur, value } } },
          items: [{ name: `${s.film} · keep forever · ${quality.toUpperCase()}`, quantity: "1", unitAmount: { currencyCode: cur, value } }],
        }],
      },
    });
    if (!result.id) return json(502, { error: "PayPal did not return an order" });
    const a = await accountApi("POST", `/v1/me/library/${encodeURIComponent(s.id)}/keep`, { quality, orderId: result.id, amountCents: Math.round(Number(value) * 100), currency: cur }, session);
    if (a.status !== 204) return NextResponse.json(a.body ?? {}, { status: a.status });
    return json(200, { orderId: result.id });
  } catch (err) {
    return paypalError(err);
  }
}
