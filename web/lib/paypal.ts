import "server-only";
import { NextResponse } from "next/server";
import { ApiError, Client, Environment, LogLevel, OrdersController, PaymentsController } from "@paypal/paypal-server-sdk";

// Sandbox unless PAYPAL_ENV is explicitly "live".
export const paypalEnv = process.env.PAYPAL_ENV === "live" ? "production" : "sandbox";

let orders: OrdersController | undefined;
let payments: PaymentsController | undefined;
let client: Client | undefined;

function paypalClient(): Client {
  if (client) return client;
  const oAuthClientId = process.env.PAYPAL_CLIENT_ID;
  const oAuthClientSecret = process.env.PAYPAL_CLIENT_SECRET;
  if (!oAuthClientId || !oAuthClientSecret) {
    throw new Error("PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET must be set");
  }
  client = new Client({
    clientCredentialsAuthCredentials: { oAuthClientId, oAuthClientSecret },
    environment: paypalEnv === "production" ? Environment.Production : Environment.Sandbox,
    timeout: 15000,
    logging: { logLevel: LogLevel.Warn, logRequest: { logBody: false }, logResponse: { logHeaders: false } },
  });
  return client;
}

export function paypalOrders(): OrdersController {
  return (orders ??= new OrdersController(paypalClient()));
}

// Refunds for cancelled seats.
export function paypalPayments(): PaymentsController {
  return (payments ??= new PaymentsController(paypalClient()));
}

// Never leak PayPal error bodies to the browser.
export function paypalError(err: unknown) {
  if (err instanceof ApiError) {
    const issue = declineIssue(err);
    console.error("PayPal error", err.statusCode, issue ?? "");
    // A declined card is the payer's to fix, not ours: say so, so the page can offer another way.
    if (issue) return NextResponse.json({ error: "Payment declined", issue }, { status: 422 });
    return NextResponse.json({ error: "Payment provider error" }, { status: 502 });
  }
  console.error("Checkout error", err instanceof Error ? err.message : err);
  return NextResponse.json({ error: "Checkout unavailable" }, { status: 500 });
}

// PayPal issue codes that mean the payer's bank or card said no (safe to show, no card data).
const DECLINES = new Set(["INSTRUMENT_DECLINED", "PAYER_ACTION_REQUIRED", "TRANSACTION_REFUSED", "CARD_EXPIRED", "PAYER_CANNOT_PAY", "INSUFFICIENT_FUNDS", "CARD_CLOSED", "PAYMENT_DENIED"]);

export function declineIssue(err: ApiError): string | undefined {
  let r = err.result as { details?: { issue?: string }[] } | undefined;
  if (!r && typeof err.body === "string") {
    try {
      r = JSON.parse(err.body);
    } catch {
      r = undefined;
    }
  }
  const issue = r?.details?.find((d) => d.issue && DECLINES.has(d.issue))?.issue;
  return issue;
}
