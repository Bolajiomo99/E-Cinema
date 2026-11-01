import { finishSeat } from "@/lib/local-seat";
import { flutterwaveSigned } from "@/lib/local-pay";

// Flutterwave webhook: carries the secret hash we set in their dashboard (verif-hash).
// We never trust the body; a completed charge is checked with Flutterwave before it counts.
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!flutterwaveSigned(req.headers.get("verif-hash"))) return new Response("bad signature", { status: 401 });
  const e = (await req.json().catch(() => ({}))) as { event?: string; "event.type"?: string; data?: { tx_ref?: string; txRef?: string } };
  const ref = e.data?.tx_ref ?? e.data?.txRef ?? "";
  if (/^FLW-[a-f0-9]{20}$/.test(ref) && (e.event === "charge.completed" || e["event.type"] === "CARD_TRANSACTION" || !e.event)) {
    const r = await finishSeat("flutterwave", ref).catch((err) => (console.error("Flutterwave webhook", err instanceof Error ? err.message : err), null));
    if (!r) return new Response("retry", { status: 500 });
  }
  return new Response("ok");
}
