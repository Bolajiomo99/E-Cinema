import { cookies } from "next/headers";
import { SESSION_COOKIE } from "@/lib/auth";
import { startSeat } from "@/lib/local-seat";
import { json, sameOrigin } from "@/lib/room-gate";

// POST /api/pay/paystack or /api/pay/flutterwave: hold a seat and open the provider's checkout.
export const dynamic = "force-dynamic";

export async function POST(req: Request, ctx: { params: Promise<{ provider: string }> }) {
  if (!sameOrigin(req)) return json(403, { error: "forbidden" });
  const { provider } = await ctx.params;
  if (provider !== "paystack" && provider !== "flutterwave") return json(404, { error: "not found" });
  const session = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!session) return json(401, { error: "Sign in to buy a seat", signIn: true });
  const b = (await req.json().catch(() => ({}))) as { showtimeId?: string; quality?: string };
  const r = await startSeat(provider, session, String(b.showtimeId ?? ""), typeof b.quality === "string" ? b.quality : undefined);
  return json(r.status, r.body);
}
