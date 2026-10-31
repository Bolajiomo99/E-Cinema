import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { accountApi, currentAccount, SESSION_COOKIE } from "@/lib/auth";
import { siteUrl } from "@/lib/google";
import { createSubscription, subscriptionsEnabled } from "@/lib/paypal-subs";
import { currencyFor, vatRate, type PlanId } from "@/lib/plans";

export const dynamic = "force-dynamic";

// POST /api/paypal/subscriptions { seats? }: starts a PayPal subscription for the plan the
// viewer picked (their pending plan) and returns PayPal's approval page to send them to.
export async function POST(req: NextRequest) {
  const origin = req.headers.get("origin");
  if (origin && new URL(origin).host !== req.headers.get("host")) return NextResponse.json({ error: "cross-site request" }, { status: 403 });
  if (!subscriptionsEnabled()) return NextResponse.json({ error: "PayPal is being switched on" }, { status: 503 });
  const session = (await cookies()).get(SESSION_COOKIE)?.value;
  const me = await currentAccount();
  if (!me || !session) return NextResponse.json({ error: "sign in first" }, { status: 401 });
  const r = await accountApi("GET", "/v1/me/profile", undefined, session);
  const profile = r.body as { country?: string; plan?: PlanId; pendingPlan?: PlanId } | null;
  const plan = profile?.pendingPlan || profile?.plan;
  if (!plan || plan === "free") return NextResponse.json({ error: "Pick a paid plan first" }, { status: 409 });
  const { seats, cycle } = (await req.json().catch(() => ({}))) as { seats?: number; cycle?: string };
  try {
    const sub = await createSubscription({
      accountId: me.id,
      plan,
      currency: currencyFor(profile?.country),
      seats: Number(seats) || undefined,
      cycle: cycle === "year" ? "year" : "month",
      origin: siteUrl(new URL(req.url).origin),
      email: me.email,
      taxPercent: vatRate(profile?.country) * 100,
    });
    return NextResponse.json({ approve: sub.approve });
  } catch {
    return NextResponse.json({ error: "PayPal could not start the subscription. Please try again." }, { status: 502 });
  }
}
