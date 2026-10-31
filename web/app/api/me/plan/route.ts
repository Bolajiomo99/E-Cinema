import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { accountApi, SESSION_COOKIE } from "@/lib/auth";
import { cancelSubscription } from "@/lib/paypal-subs";

export const dynamic = "force-dynamic";

// PUT /api/me/plan: the plan picked at sign-up or on the plans page. Paid plans wait for
// payment; moving to Free cancels the PayPal subscription first so billing stops.
export async function PUT(req: NextRequest) {
  const origin = req.headers.get("origin");
  if (origin && new URL(origin).host !== req.headers.get("host")) return NextResponse.json({ error: "cross-site request" }, { status: 403 });
  const session = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!session) return NextResponse.json({ error: "sign in first" }, { status: 401 });
  const { plan } = (await req.json().catch(() => ({}))) as { plan?: string };
  if (plan === "free") {
    const s = await accountApi("GET", "/v1/me/subscription", undefined, session);
    const sub = (s.body as { id?: string } | null)?.id;
    if (sub) {
      try {
        await cancelSubscription(sub, "Moved to the Free plan");
      } catch {
        return NextResponse.json({ error: "PayPal could not cancel your subscription. Please try again." }, { status: 502 });
      }
      await accountApi("POST", "/v1/internal/plans/end", { subscriptionId: sub });
    }
  }
  const r = await accountApi("PUT", "/v1/me/plan", { plan: String(plan ?? "") }, session);
  return NextResponse.json(r.body, { status: r.status });
}
