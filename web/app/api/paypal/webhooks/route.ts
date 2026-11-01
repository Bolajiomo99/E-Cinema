import { NextResponse } from "next/server";
import { verifyWebhook, type PayPalEvent } from "@/lib/paypal-webhook";
import { markPaid, markRefunded, SoldOutError } from "@/lib/api";
import { sweepGifts } from "@/lib/gifts";
import { activateFromPayPal, endFromPayPal } from "@/lib/plan-activation";
import type { Subscription } from "@/lib/paypal-subs";

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
  "BILLING.SUBSCRIPTION.EXPIRED",
  "BILLING.SUBSCRIPTION.SUSPENDED",
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
  // A refund, from a cancelled seat or issued in the PayPal dashboard, frees the seat.
  if (event.event_type === "PAYMENT.CAPTURE.REFUNDED") {
    const refundId = event.resource?.id as string | undefined;
    const up = (event.resource?.links as { rel?: string; href?: string }[] | undefined)?.find((l) => l.rel === "up")?.href;
    const captureId = up?.split("/captures/")[1]?.split(/[/?]/)[0];
    if (refundId && captureId) {
      try {
        await markRefunded(captureId, refundId);
      } catch (err) {
        // 409: no paid seat for this capture (already refunded, or not a ticket). Nothing to retry.
        if (!(err instanceof SoldOutError)) {
          console.error("Refund ledger update failed", err instanceof Error ? err.message : err);
          return NextResponse.json({ error: "Retry later" }, { status: 503 });
        }
      }
    }
  }
  if (event.event_type === "PAYMENT.CAPTURE.COMPLETED") {
    const orderId = (event.resource?.supplementary_data as { related_ids?: { order_id?: string } } | undefined)?.related_ids?.order_id;
    const captureId = event.resource?.id as string | undefined;
    if (orderId && captureId) {
      try {
        await markPaid(orderId, captureId);
        await sweepGifts(true).catch(() => undefined);
      } catch (err) {
        console.error("Ledger update failed", err instanceof Error ? err.message : err);
        return NextResponse.json({ error: "Retry later" }, { status: 503 }); // PayPal retries
      }
    }
  }
  // Plan subscriptions: activation backs up the return page, the rest drop the plan to Free.
  if (event.event_type.startsWith("BILLING.SUBSCRIPTION.")) {
    const sub = event.resource as unknown as Subscription;
    try {
      if (event.event_type === "BILLING.SUBSCRIPTION.ACTIVATED") await activateFromPayPal(sub);
      else if (["BILLING.SUBSCRIPTION.CANCELLED", "BILLING.SUBSCRIPTION.EXPIRED", "BILLING.SUBSCRIPTION.SUSPENDED"].includes(event.event_type) && sub?.id) await endFromPayPal(sub.id);
    } catch (err) {
      console.error("Plan update failed", err instanceof Error ? err.message : err);
      return NextResponse.json({ error: "Retry later" }, { status: 503 });
    }
  }
  if (HANDLED.has(event.event_type)) {
    // Ticket issuing, refunds, dispute holds and studio payout status are written here once the database exists.
    console.info("PayPal event", event.event_type, event.id);
  }
  return NextResponse.json({ received: true });
}
