import "server-only";
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

// Paystack and Flutterwave hosted checkouts for Nigeria and the rest of Africa. Both charge in
// naira; the seat price comes from the server quote and is converted at today's rate. A payment
// only counts after we ask the provider ourselves (verify), never because a browser says so.
export type Provider = "paystack" | "flutterwave";
export const PREFIX: Record<Provider, string> = { paystack: "PSK", flutterwave: "FLW" };

export const providerReady = (p: Provider) => Boolean(p === "paystack" ? process.env.PAYSTACK_SECRET_KEY : process.env.FLUTTERWAVE_SECRET_KEY);

export type Started = { url: string; reference: string };
export type Verified = { ok: boolean; reference: string; txId: string; amountKobo: number; currency: string; meta: Record<string, string>; why?: string };

const psKey = () => process.env.PAYSTACK_SECRET_KEY ?? "";
const flKey = () => process.env.FLUTTERWAVE_SECRET_KEY ?? "";

export const newReference = (p: Provider) => `${PREFIX[p]}-${randomUUID().replace(/-/g, "").slice(0, 20)}`;

export async function startPayment(p: Provider, o: { reference: string; amountKobo: number; email: string; name: string; title: string; returnUrl: string; meta: Record<string, string> }): Promise<Started> {
  if (p === "paystack") {
    const r = await fetch("https://api.paystack.co/transaction/initialize", {
      method: "POST",
      headers: { Authorization: `Bearer ${psKey()}`, "Content-Type": "application/json" },
      body: JSON.stringify({ email: o.email, amount: o.amountKobo, currency: "NGN", reference: o.reference, callback_url: o.returnUrl, metadata: { ...o.meta, expected: String(o.amountKobo) } }),
      signal: AbortSignal.timeout(15000),
    });
    const j = (await r.json().catch(() => ({}))) as { status?: boolean; message?: string; data?: { authorization_url?: string } };
    if (!r.ok || !j.status || !j.data?.authorization_url) throw new Error(j.message || "Paystack could not start the payment");
    return { url: j.data.authorization_url, reference: o.reference };
  }
  const r = await fetch("https://api.flutterwave.com/v3/payments", {
    method: "POST",
    headers: { Authorization: `Bearer ${flKey()}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      tx_ref: o.reference,
      amount: (o.amountKobo / 100).toFixed(2),
      currency: "NGN",
      redirect_url: o.returnUrl,
      customer: { email: o.email, name: o.name },
      meta: { ...o.meta, expected: String(o.amountKobo) },
      customizations: { title: "E-Cinema", description: o.title },
    }),
    signal: AbortSignal.timeout(15000),
  });
  const j = (await r.json().catch(() => ({}))) as { status?: string; message?: string; data?: { link?: string } };
  if (!r.ok || j.status !== "success" || !j.data?.link) throw new Error(j.message || `Flutterwave could not start the payment (${r.status})`);
  return { url: j.data.link, reference: o.reference };
}

// Asks the provider what really happened to a reference.
export async function verifyPayment(p: Provider, reference: string): Promise<Verified> {
  const none: Verified = { ok: false, reference, txId: "", amountKobo: 0, currency: "", meta: {} };
  if (p === "paystack") {
    const r = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, { headers: { Authorization: `Bearer ${psKey()}` }, signal: AbortSignal.timeout(15000) });
    const j = (await r.json().catch(() => ({}))) as { data?: { status?: string; id?: number; amount?: number; currency?: string; reference?: string; gateway_response?: string; metadata?: Record<string, unknown> } };
    const d = j.data;
    if (!r.ok || !d) return { ...none, why: "We could not confirm the payment with Paystack" };
    const meta = Object.fromEntries(Object.entries(d.metadata ?? {}).map(([k, v]) => [k, String(v)]));
    return { ok: d.status === "success" && d.reference === reference, reference, txId: String(d.id ?? ""), amountKobo: d.amount ?? 0, currency: d.currency ?? "", meta, why: d.status === "success" ? undefined : d.gateway_response || "The payment did not go through" };
  }
  const r = await fetch(`https://api.flutterwave.com/v3/transactions/verify_by_reference?tx_ref=${encodeURIComponent(reference)}`, { headers: { Authorization: `Bearer ${flKey()}` }, signal: AbortSignal.timeout(15000) });
  const j = (await r.json().catch(() => ({}))) as { data?: { status?: string; id?: number; amount?: number; charged_amount?: number; currency?: string; tx_ref?: string; processor_response?: string; meta?: Record<string, unknown> | null } };
  const d = j.data;
  if (!r.ok || !d) return { ...none, why: "We could not confirm the payment with Flutterwave" };
  const meta = Object.fromEntries(Object.entries(d.meta ?? {}).map(([k, v]) => [k, String(v)]));
  return { ok: d.status === "successful" && d.tx_ref === reference, reference, txId: String(d.id ?? ""), amountKobo: Math.round((d.amount ?? 0) * 100), currency: d.currency ?? "", meta, why: d.status === "successful" ? undefined : d.processor_response || "The payment did not go through" };
}

// A verified payment counts only if it is in naira and at least what we asked for.
export const covers = (v: Verified) => v.ok && v.currency === "NGN" && Number(v.meta.expected) > 0 && v.amountKobo >= Number(v.meta.expected);

// Refunds a seat paid through Paystack or Flutterwave. txId is the provider's transaction id.
export async function refundPayment(p: Provider, reference: string, txId: string): Promise<{ ok: boolean; id: string; error?: string }> {
  if (p === "paystack") {
    const r = await fetch("https://api.paystack.co/refund", { method: "POST", headers: { Authorization: `Bearer ${psKey()}`, "Content-Type": "application/json" }, body: JSON.stringify({ transaction: reference }), signal: AbortSignal.timeout(15000) });
    const j = (await r.json().catch(() => ({}))) as { status?: boolean; message?: string; data?: { id?: number } };
    return r.ok && j.status ? { ok: true, id: `PSKR-${j.data?.id ?? reference}` } : { ok: false, id: "", error: j.message || "Paystack refused the refund" };
  }
  const r = await fetch(`https://api.flutterwave.com/v3/transactions/${encodeURIComponent(txId)}/refund`, { method: "POST", headers: { Authorization: `Bearer ${flKey()}`, "Content-Type": "application/json" }, body: "{}", signal: AbortSignal.timeout(15000) });
  const j = (await r.json().catch(() => ({}))) as { status?: string; message?: string; data?: { id?: number } };
  return r.ok && j.status === "success" ? { ok: true, id: `FLWR-${j.data?.id ?? txId}` } : { ok: false, id: "", error: j.message || "Flutterwave refused the refund" };
}

// Webhook checks: Paystack signs the body with the secret key; Flutterwave sends our secret hash.
export function paystackSigned(raw: string, sig: string | null): boolean {
  if (!sig || !psKey()) return false;
  const want = createHmac("sha512", psKey()).update(raw).digest("hex");
  return want.length === sig.length && timingSafeEqual(Buffer.from(want), Buffer.from(sig));
}
export function flutterwaveSigned(hash: string | null): boolean {
  const want = process.env.FLUTTERWAVE_WEBHOOK_HASH ?? "";
  if (!hash || !want || hash.length !== want.length) return false;
  return timingSafeEqual(Buffer.from(hash), Buffer.from(want));
}

// "PSK-abc" -> paystack.
export const providerOf = (ref: string): Provider | null => (ref.startsWith("PSK-") ? "paystack" : ref.startsWith("FLW-") ? "flutterwave" : null);
