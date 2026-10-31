import "server-only";
import { NextResponse } from "next/server";
import { ApiError, Client, Environment, LogLevel, OrdersController } from "@paypal/paypal-server-sdk";

// Sandbox unless PAYPAL_ENV is explicitly "live".
export const paypalEnv = process.env.PAYPAL_ENV === "live" ? "production" : "sandbox";

let orders: OrdersController | undefined;

export function paypalOrders(): OrdersController {
  if (orders) return orders;
  const oAuthClientId = process.env.PAYPAL_CLIENT_ID;
  const oAuthClientSecret = process.env.PAYPAL_CLIENT_SECRET;
  if (!oAuthClientId || !oAuthClientSecret) {
    throw new Error("PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET must be set");
  }
  const client = new Client({
    clientCredentialsAuthCredentials: { oAuthClientId, oAuthClientSecret },
    environment: paypalEnv === "production" ? Environment.Production : Environment.Sandbox,
    timeout: 15000,
    logging: { logLevel: LogLevel.Warn, logRequest: { logBody: false }, logResponse: { logHeaders: false } },
  });
  orders = new OrdersController(client);
  return orders;
}

// Never leak PayPal error bodies to the browser.
export function paypalError(err: unknown) {
  if (err instanceof ApiError) {
    console.error("PayPal error", err.statusCode);
    return NextResponse.json({ error: "Payment provider error" }, { status: 502 });
  }
  console.error("Checkout error", err instanceof Error ? err.message : err);
  return NextResponse.json({ error: "Checkout unavailable" }, { status: 500 });
}
