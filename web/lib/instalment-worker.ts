import "server-only";
import { chargeSavedCard, providerReady } from "@/lib/local-pay";

// Pay in 6 (Shop hero, Cart 53:1111): every hour, charges the shop instalments that are due to
// the card Paystack saved with the first part, then tells the API how each went. The API
// moves the next date on a month, or retries a declined part the next day (three tries).
type Due = { orderId: string; number: string; part: number; parts: number; amountNgn: number; authCode: string; email: string; reference: string };

async function internal<T>(path: string, body: unknown = {}): Promise<T | null> {
  const base = process.env.API_URL, token = process.env.INTERNAL_API_TOKEN;
  if (!base || !token) return null;
  const r = await fetch(`${base}${path}`, {
    method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body), signal: AbortSignal.timeout(30_000), cache: "no-store",
  }).catch(() => null);
  if (!r?.ok) return null;
  return (await r.json().catch(() => ({}))) as T;
}

let running = false;
export async function runInstalments() {
  if (running || !providerReady("paystack")) return;
  running = true;
  try {
    const list = await internal<{ due: Due[] }>("/v1/shop/instalments/due");
    for (const d of list?.due ?? []) {
      const r = await chargeSavedCard({
        code: d.authCode, email: d.email, amountKobo: d.amountNgn * 100, reference: d.reference,
        meta: { kind: "shop-part", orderId: d.orderId, part: String(d.part) },
      });
      await internal(`/v1/shop/instalments/${d.orderId}/result`, { part: d.part, ok: r.ok, reference: d.reference, error: r.why ?? "" });
    }
  } catch (e) {
    console.error("instalments", e instanceof Error ? e.message : e);
  } finally {
    running = false;
  }
}

export function startInstalmentWorker() {
  setTimeout(() => void runInstalments(), 90_000).unref?.();
  setInterval(() => void runInstalments(), 3_600_000).unref?.();
}
