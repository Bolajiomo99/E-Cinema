import "server-only";
import { paypalEnv } from "@/lib/paypal";

// PayPal's Server SDK has no webhooks controller, so this calls the REST endpoint directly.
export const base = () => (paypalEnv === "production" ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com");

let cached: { token: string; expires: number } | undefined;

export async function accessToken(): Promise<string> {
  if (cached && cached.expires > Date.now() + 60_000) return cached.token;
  const basic = Buffer.from(`${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_CLIENT_SECRET}`).toString("base64");
  const res = await fetch(`${base()}/v1/oauth2/token`, {
    method: "POST",
    headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials",
  });
  if (!res.ok) throw new Error(`PayPal token ${res.status}`);
  const data = (await res.json()) as { access_token: string; expires_in: number };
  cached = { token: data.access_token, expires: Date.now() + data.expires_in * 1000 };
  return cached.token;
}

const HEADERS = ["paypal-auth-algo", "paypal-cert-url", "paypal-transmission-id", "paypal-transmission-sig", "paypal-transmission-time"] as const;

// Asks PayPal whether this delivery really came from PayPal for our webhook.
export async function verifyWebhook(headers: Headers, rawBody: string): Promise<boolean> {
  const webhookId = process.env.PAYPAL_WEBHOOK_ID;
  if (!webhookId) throw new Error("PAYPAL_WEBHOOK_ID is not set");
  const h = Object.fromEntries(HEADERS.map((k) => [k, headers.get(k)]));
  if (HEADERS.some((k) => !h[k])) return false;
  // Only accept certificates served by PayPal.
  if (!/^https:\/\/api(-m)?\.(sandbox\.)?paypal\.com\//.test(h["paypal-cert-url"]!)) return false;

  const res = await fetch(`${base()}/v1/notifications/verify-webhook-signature`, {
    method: "POST",
    headers: { Authorization: `Bearer ${await accessToken()}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      auth_algo: h["paypal-auth-algo"],
      cert_url: h["paypal-cert-url"],
      transmission_id: h["paypal-transmission-id"],
      transmission_sig: h["paypal-transmission-sig"],
      transmission_time: h["paypal-transmission-time"],
      webhook_id: webhookId,
      webhook_event: JSON.parse(rawBody),
    }),
  });
  if (!res.ok) return false;
  const { verification_status } = (await res.json()) as { verification_status?: string };
  return verification_status === "SUCCESS";
}

export type PayPalEvent = { id: string; event_type: string; resource_type?: string; resource?: Record<string, unknown> };
