import { finishSeat } from "@/lib/local-seat";
import { paystackSigned } from "@/lib/local-pay";

// Paystack webhook: signed with our secret key (x-paystack-signature, HMAC SHA-512).
// A successful charge marks the seat paid even if the buyer closed the tab before returning.
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const raw = await req.text();
  if (!paystackSigned(raw, req.headers.get("x-paystack-signature"))) return new Response("bad signature", { status: 401 });
  const e = JSON.parse(raw || "{}") as { event?: string; data?: { reference?: string } };
  const ref = e.data?.reference ?? "";
  if (e.event === "charge.success" && /^PSK-[a-f0-9]{20}$/.test(ref)) {
    const r = await finishSeat("paystack", ref).catch((err) => (console.error("Paystack webhook", err instanceof Error ? err.message : err), null));
    if (!r) return new Response("retry", { status: 500 });
  }
  return new Response("ok");
}
