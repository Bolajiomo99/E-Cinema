import { cookies } from "next/headers";
import type { NextRequest } from "next/server";
import { CheckoutPaymentIntent } from "@paypal/paypal-server-sdk";
import { randomUUID } from "node:crypto";
import { accountApi, currentAccount, SESSION_COOKIE } from "@/lib/auth";
import { readLocale } from "@/lib/locale";
import { paypalError, paypalOrders, paypalPayments } from "@/lib/paypal";
import { kidsGate } from "@/lib/family";
import { json, sameOrigin } from "@/lib/room-gate";
import { chargeFor, isStaff, myQuote } from "@/lib/store";
import { switchOn } from "@/lib/platform";
import { newReference, providerReady, refundPayment, startPayment, type Provider } from "@/lib/local-pay";
import type { Order, Quote } from "@/lib/store-types";

// The E-Cinema store (Figma 53:925, 96:1194, 53:1111, 89:894): cart, address, checkout with
// PayPal or pay on delivery, cancel with refund, returns, reorders, reviews, and the delivery
// team's order desk. Everything else is the Go shop API's job.
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f-]{36}$/;
const PAID_ONLINE = new Set(["paypal", "paystack", "flutterwave"]);
const site = () => (process.env.WEB_URL || "https://e-cinema.net").replace(/\/$/, "");
const pass = (r: { status: number; body: unknown }) => json(r.status === 204 ? 200 : r.status, r.body ?? {});

async function refund(captureId: string, key: string) {
  return Boolean(await refundId(captureId, key));
}

async function refundId(captureId: string, key: string): Promise<string> {
  // Paystack and Flutterwave orders keep "reference~transaction" as their capture.
  const local = /^(PSK|FLW)-[a-f0-9]{20}~(.+)$/.exec(captureId);
  if (local) {
    const p: Provider = local[1] === "PSK" ? "paystack" : "flutterwave";
    const r = await refundPayment(p, captureId.split("~")[0], local[2]).catch(() => ({ ok: false, id: "" }));
    if (!r.ok) console.error("Shop refund failed", p, key);
    return r.ok ? r.id || "refunded" : "";
  }
  try {
    const { result } = await paypalPayments().refundCapturedPayment({ captureId, paypalRequestId: `shop-refund-${key}`, prefer: "return=minimal" });
    return result.id ?? "refunded";
  } catch (err) {
    console.error("Shop refund failed", err instanceof Error ? err.message : err);
    return "";
  }
}

// An approved refund request on a PayPal order gets its capture refunded and the refund id kept.
async function payRequest(b: { refund: { id: string; status: string; outcome: string }; method: string; captureId?: string }) {
  if (b.refund.status !== "approved" || b.refund.outcome !== "refund" || !PAID_ONLINE.has(b.method) || !b.captureId) return false;
  const id = await refundId(b.captureId, `request-${b.refund.id}`);
  if (id) await accountApi("POST", `/v1/shop/refunds/${b.refund.id}/paid`, { refundId: id });
  return Boolean(id);
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ path?: string[] }> }) {
  const p = (await params).path ?? [];
  const session = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!session) return json(401, { error: "Sign in first", signIn: true });
  if (p[0] === "cart") {
    const q = await myQuote(session, (await readLocale()).country);
    return q ? json(200, q) : json(502, { error: "Cart unavailable" });
  }
  if (p[0] === "orders" && UUID.test(p[1] ?? "") && p[2] === "refund") return pass(await accountApi("GET", `/v1/me/orders/${p[1]}/refund`, undefined, session));
  if (p[0] === "orders") return pass(await accountApi("GET", "/v1/me/orders", undefined, session));
  if (p[0] === "refunds") {
    const me = await currentAccount();
    if (!isStaff(me?.email)) return json(403, { error: "Staff only" });
    return pass(await accountApi("GET", "/v1/shop/refunds"));
  }
  if (p[0] === "ops") {
    const me = await currentAccount();
    if (!isStaff(me?.email)) return json(403, { error: "Staff only" });
    return pass(await accountApi("GET", "/v1/shop/orders/open"));
  }
  return json(404, { error: "Not found" });
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ path?: string[] }> }) {
  if (!sameOrigin(req)) return json(403, { error: "forbidden" });
  const p = (await params).path ?? [];
  const session = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!session) return json(401, { error: "Sign in to shop", signIn: true });
  const body = await req.json().catch(() => ({}));
  const country = (await readLocale()).country ?? "";
  if (p[0] === "cart") return pass(await accountApi("PUT", `/v1/me/cart?country=${country}`, body, session));
  if (p[0] === "address") return pass(await accountApi("PUT", `/v1/me/shop-address?country=${country}`, body, session));
  if (p[0] === "reviews" && /^[a-z0-9-]{2,40}$/.test(p[1] ?? "")) return pass(await accountApi("PUT", `/v1/me/shop-reviews/${p[1]}`, body, session));
  return json(404, { error: "Not found" });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ path?: string[] }> }) {
  if (!sameOrigin(req)) return json(403, { error: "forbidden" });
  const p = (await params).path ?? [];
  const session = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!session) return json(401, { error: "Sign in to shop", signIn: true });
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const country = (await readLocale()).country ?? "";

  if (p[0] === "checkout") {
    const gate = await kidsGate(session);
    if (gate) return gate;
    return checkout(session, country, body);
  }

  if (p[0] === "orders" && UUID.test(p[1] ?? "")) {
    if (p[2] === "cancel") {
      const r = await accountApi("POST", `/v1/me/orders/${p[1]}/cancel`, {}, session);
      if (r.status !== 200) return pass(r);
      const b = r.body as { order: Order; captureId?: string; method: string };
      const refunded = PAID_ONLINE.has(b.method) && b.captureId ? await refund(b.captureId, b.order.id) : false;
      return json(200, { order: b.order, refunded });
    }
    if (p[2] === "return") return pass(await accountApi("POST", `/v1/me/orders/${p[1]}/return`, { reason: body.reason }, session));
    if (p[2] === "refund") {
      // Pay-on-delivery refunds go to the wallet in US cents at today's rate.
      const info = await accountApi("GET", `/v1/me/orders/${p[1]}/refund`, undefined, session);
      if (info.status !== 200) return pass(info);
      const total = (info.body as { order: Order }).order.totalNgn;
      const usd = total > 0 ? await chargeFor(total, "US") : null;
      const r = await accountApi("POST", `/v1/me/orders/${p[1]}/refund`, {
        reason: body.reason, note: body.note ?? "", outcome: body.outcome, creditCents: usd?.currency === "USD" ? usd.cents : 0,
      }, session);
      if (r.status !== 201) return pass(r);
      const b = r.body as { refund: { id: string; status: string; outcome: string }; method: string; captureId?: string };
      return json(200, { refund: b.refund, refunded: await payRequest(b) });
    }
    if (p[2] === "reorder") return pass(await accountApi("POST", `/v1/me/orders/${p[1]}/reorder?country=${country}`, {}, session));
  }

  if (p[0] === "ops" && /^EC-\d{3,9}$/.test(p[1] ?? "") && p[2] === "status") {
    const me = await currentAccount();
    if (!isStaff(me?.email)) return json(403, { error: "Staff only" });
    const r = await accountApi("POST", `/v1/shop/orders/${p[1]}/status`, { status: body.status, rider: body.rider ?? null });
    if (r.status !== 200) return pass(r);
    const b = r.body as { order: Order; captureId?: string };
    // A cancelled paid order or a finished return gets its money back.
    let refunded = false;
    if (PAID_ONLINE.has(b.order.method) && b.captureId && (b.order.status === "cancelled" || b.order.status === "returned")) refunded = await refund(b.captureId, b.order.id);
    return json(200, { order: b.order, refunded });
  }
  if (p[0] === "refunds" && UUID.test(p[1] ?? "")) {
    const me = await currentAccount();
    if (!isStaff(me?.email)) return json(403, { error: "Staff only" });
    const r = await accountApi("POST", `/v1/shop/refunds/${p[1]}`, { action: body.action });
    if (r.status === 204) return json(200, { ok: true });
    if (r.status !== 200) return pass(r);
    const b = r.body as { refund: { id: string; status: string; outcome: string }; method: string; captureId?: string };
    return json(200, { refund: b.refund, refunded: await payRequest(b) });
  }
  return json(404, { error: "Not found" });
}

// Checkout: pay on delivery places the order now; PayPal creates the order for the buyer to
// approve and records it as pending until the capture confirms it.
async function checkout(session: string, country: string, body: Record<string, unknown>) {
  const method = ["cod", "paypal", "paystack", "flutterwave"].includes(String(body.method)) ? String(body.method) : "";
  if (!method) return json(400, { error: "Choose how to pay" });
  if (method === "paystack" || method === "flutterwave") return localCheckout(method, session, country, body);
  const expect = Number(body.expectTotalNgn);
  if (method === "cod" && !switchOn("pay.cod")) return json(503, { error: "Pay on delivery is switched off just now" });
  if (method === "paypal" && !switchOn("pay.paypal")) return json(503, { error: "PayPal is switched off just now" });
  if (method === "cod") return pass(await accountApi("POST", "/v1/me/orders", { method, country, expectTotalNgn: expect }, session));

  const q: Quote | null = await myQuote(session, country);
  if (!q) return json(502, { error: "Cart unavailable" });
  if (!q.lines.length) return json(400, { error: "Your cart is empty" });
  if (!q.address) return json(400, { error: "Add a delivery address first" });
  if (q.problems.length) return json(409, { error: q.problems.join(". ") });
  if (q.totalNgn !== expect) return json(409, { error: "Prices changed while you were paying; please check your cart again" });
  const charge = await chargeFor(q.totalNgn, country);
  if (!charge) return json(503, { error: "Card payments are briefly unavailable. Try pay on delivery or come back soon." });
  const value = (charge.cents / 100).toFixed(2);
  try {
    const { result } = await paypalOrders().createOrder({
      paypalRequestId: randomUUID(),
      prefer: "return=minimal",
      body: {
        intent: CheckoutPaymentIntent.Capture,
        purchaseUnits: [{
          referenceId: "shop",
          customId: "shop",
          description: `E-Cinema shop: ${q.count} item${q.count === 1 ? "" : "s"}`,
          // One line for the whole basket: the naira breakdown is on our receipt, PayPal only sees the charge.
          amount: { currencyCode: charge.currency, value, breakdown: { itemTotal: { currencyCode: charge.currency, value } } },
          items: [{ name: q.lines.map((l) => `${l.qty} × ${l.product.name}`).join(", ").slice(0, 127), quantity: "1", unitAmount: { currencyCode: charge.currency, value } }],
        }],
      },
    });
    if (!result.id) return json(502, { error: "PayPal did not return an order" });
    const r = await accountApi("POST", "/v1/me/orders", {
      method, country, expectTotalNgn: expect, chargeCurrency: charge.currency, chargeCents: charge.cents, paypalOrderId: result.id,
    }, session);
    if (r.status !== 201) return pass(r);
    return json(200, { orderId: result.id, order: r.body });
  } catch (err) {
    return paypalError(err);
  }
}

// Paystack and Flutterwave: the order waits as pending under the provider reference, and the
// buyer pays on the provider's page in naira. The return page and the webhook confirm it.
async function localCheckout(p: Provider, session: string, country: string, body: Record<string, unknown>) {
  if (!providerReady(p)) return json(503, { error: "This payment method is not switched on yet" });
  const expect = Number(body.expectTotalNgn);
  const q: Quote | null = await myQuote(session, country);
  if (!q) return json(502, { error: "Cart unavailable" });
  if (!q.lines.length) return json(400, { error: "Your cart is empty" });
  if (!q.address) return json(400, { error: "Add a delivery address first" });
  if (q.problems.length) return json(409, { error: q.problems.join(". ") });
  if (q.totalNgn !== expect) return json(409, { error: "Prices changed while you were paying; please check your cart again" });
  const me = await currentAccount();
  if (!me) return json(401, { error: "Sign in first", signIn: true });
  const reference = newReference(p);
  const amountKobo = q.totalNgn * 100;
  const r = await accountApi("POST", "/v1/me/orders", { method: p, country, expectTotalNgn: expect, chargeCurrency: "NGN", chargeCents: amountKobo, paypalOrderId: reference }, session);
  if (r.status !== 201) return pass(r);
  const order = r.body as Order;
  try {
    const started = await startPayment(p, {
      reference, amountKobo, email: me.email, name: me.name || "E-Cinema member",
      title: `E-Cinema shop: ${q.count} item${q.count === 1 ? "" : "s"}`,
      returnUrl: `${site()}/api/pay/${p}/return`,
      meta: { kind: "shop", orderId: order.id },
    });
    return json(200, { url: started.url, order });
  } catch (e) {
    const name = p === "paystack" ? "Paystack" : "Flutterwave";
    console.error(`${name} shop start failed`, e instanceof Error ? e.message : e);
    return json(502, { error: e instanceof Error && !/fetch failed|timeout|aborted/i.test(e.message) ? e.message : `${name} is not answering right now. Try again, or pay with PayPal.` });
  }
}
