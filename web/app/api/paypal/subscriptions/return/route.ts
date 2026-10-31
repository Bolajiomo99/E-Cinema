import { NextResponse, type NextRequest } from "next/server";
import { currentAccount } from "@/lib/auth";
import { siteUrl } from "@/lib/google";
import { activateFromPayPal } from "@/lib/plan-activation";
import { getSubscription } from "@/lib/paypal-subs";

export const dynamic = "force-dynamic";

// PayPal sends the viewer back here after they approve. We never trust the query string:
// the subscription is read back from PayPal and must belong to the signed-in account.
export async function GET(req: NextRequest) {
  const site = siteUrl(new URL(req.url).origin);
  const id = req.nextUrl.searchParams.get("subscription_id") ?? "";
  const me = await currentAccount();
  if (!me) return NextResponse.redirect(`${site}/signin?next=/join?step=4`);
  if (!/^I-[A-Z0-9]{6,30}$/.test(id)) return NextResponse.redirect(`${site}/join?step=4&failed=1`);
  try {
    const sub = await getSubscription(id);
    const plan = await activateFromPayPal(sub, me.id);
    if (!plan) return NextResponse.redirect(`${site}/join?step=4&failed=1`);
    return NextResponse.redirect(`${site}/plan/success?plan=${plan}`);
  } catch {
    return NextResponse.redirect(`${site}/join?step=4&failed=1`);
  }
}
