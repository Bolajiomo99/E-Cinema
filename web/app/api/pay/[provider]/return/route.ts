import { NextResponse, type NextRequest } from "next/server";
import { finishSeat } from "@/lib/local-seat";

// The provider sends the buyer back here. We check the payment with the provider ourselves.
export const dynamic = "force-dynamic";

const REF = /^(PSK|FLW)-[a-f0-9]{20}$/;

export async function GET(req: NextRequest, ctx: { params: Promise<{ provider: string }> }) {
  const { provider } = await ctx.params;
  const u = req.nextUrl;
  const home = (path: string) => NextResponse.redirect(new URL(path, process.env.WEB_URL || u.origin));
  if (provider !== "paystack" && provider !== "flutterwave") return home("/checkout");
  const ref = (provider === "paystack" ? u.searchParams.get("reference") ?? u.searchParams.get("trxref") : u.searchParams.get("tx_ref")) ?? "";
  if (!REF.test(ref) || !ref.startsWith(provider === "paystack" ? "PSK-" : "FLW-")) return home("/checkout");
  const r = await finishSeat(provider, ref).catch(() => ({ paid: false, showtimeId: "", why: "We could not confirm the payment" }));
  if (r.paid) return home(`/tickets/confirmed?film=${encodeURIComponent(r.showtimeId)}`);
  const cancelled = u.searchParams.get("status") === "cancelled";
  return home(`/checkout/failed?film=${encodeURIComponent(r.showtimeId)}&why=${encodeURIComponent(cancelled ? "You cancelled the payment" : (r.why ?? "The payment did not go through"))}`);
}
