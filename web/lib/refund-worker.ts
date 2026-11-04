import "server-only";
import { markRefunded } from "@/lib/api";
import { paypalPayments } from "@/lib/paypal";
import { providerOf, refundPayment } from "@/lib/local-pay";

// Pays back every seat of a premiere its studio withdrew (Figma 99:247 Danger zone). The API
// lists seats still owed; each is refunded the way it was paid: PayPal, Paystack, Flutterwave
// or E-Cinema credit, and seats nobody paid money for are simply freed. Marking a seat refunded
// queues email 30 (127:149) for its holder. Refund requests are keyed by the seat, so a retry
// never pays twice.
type Due = { holdId: string; accountId: string; captureId: string; film: string };

async function internal<T>(path: string): Promise<T | null> {
  const base = process.env.API_URL, token = process.env.INTERNAL_API_TOKEN;
  if (!base || !token) return null;
  const r = await fetch(`${base}${path}`, {
    method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: "{}",
    signal: AbortSignal.timeout(30_000), cache: "no-store",
  }).catch(() => null);
  if (!r?.ok) return null;
  return (await r.json().catch(() => ({}))) as T;
}

async function payBack(d: Due): Promise<string> {
  if (!d.captureId) return (await internal(`/v1/refunds/${d.holdId}/free`)) ? "" : "could not free the seat";
  if (d.captureId === `CREDIT-${d.holdId}`) return (await internal(`/v1/refunds/${d.holdId}/credit`)) ? "" : "credit refund failed";
  const local = providerOf(d.captureId);
  if (local) {
    const [ref, tx] = d.captureId.split("~");
    const r = await refundPayment(local, ref, tx ?? "");
    if (!r.ok) return r.error ?? "refund failed";
    await markRefunded(d.captureId, r.id);
    return "";
  }
  const { result } = await paypalPayments().refundCapturedPayment({ captureId: d.captureId, paypalRequestId: `refund-${d.holdId}`, prefer: "return=minimal" });
  if (!result.id) return "PayPal did not confirm the refund";
  await markRefunded(d.captureId, result.id);
  return "";
}

let running = false;
export async function runRefunds() {
  if (running) return 0;
  running = true;
  let paid = 0;
  try {
    const due = await internal<{ refunds?: Due[] }>("/v1/refunds/due");
    for (const d of due?.refunds ?? []) {
      const failure = await payBack(d).catch((e: unknown) => (e instanceof Error ? e.message : "refund failed"));
      if (failure) console.error("withdrawn premiere refund", d.film, d.holdId, failure);
      else paid++;
    }
  } finally {
    running = false;
  }
  return paid;
}

export function startRefundWorker() {
  setInterval(() => void runRefunds(), 5 * 60_000).unref?.();
}
