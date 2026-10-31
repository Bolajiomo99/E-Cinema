import { NextResponse } from "next/server";
import { verifyWebhook, type PayPalEvent } from "@/lib/paypal-webhook";

// Events we act on. Everything is acknowledged so PayPal stops retrying, but unknown types are ignored.
const HANDLED = new Set([
  "CHECKOUT.ORDER.APPROVED",
  "PAYMENT.CAPTURE.COMPLETED",
  "PAYMENT.CAPTURE.DENIED",
  "PAYMENT.CAPTURE.REFUNDED",
  "CUSTOMER.DISPUTE.CREATED",
  "CUSTOMER.DISPUTE.RESOLVED",
  "BILLING.SUBSCRIPTION.ACTIVATED",
  "BILLING.SUBSCRIPTION.CANCELLED",
  "PAYMENT.PAYOUTS-ITEM.SUCCEEDED",
  "PAYMENT.PAYOUTS-ITEM.FAILED",
]);

export async function POST(req: Request) {
  const raw = await req.text();
  if (raw.length > 256_000) return NextResponse.json({ error: "Too large" }, { status: 413 });

  let ok = false;
  try {
    ok = await verifyWebhook(req.headers, raw);
  } catch (err) {
    console.error("Webhook verify error", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Unavailable" }, { status: 503 }); // PayPal will retry
  }
  if (!ok) return NextResponse.json({ error: "Bad signature" }, { status: 400 });

  const event = JSON.parse(raw) as PayPalEvent;
  if (HANDLED.has(event.event_type)) {
    // Ticket issuing, refunds, dispute holds and studio payout status are written here once the database exists.
    console.info("PayPal event", event.event_type, event.id);
  }
  return NextResponse.json({ received: true });
}
