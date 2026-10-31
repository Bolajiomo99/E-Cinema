import "server-only";
import { accountApi } from "@/lib/auth";
import { cancelSubscription, parseCustom, type Subscription } from "@/lib/paypal-subs";

// Applies an approved subscription to the account named in its custom_id. The return page
// passes the signed-in account so one viewer can never claim another's subscription.
// The subscription it replaces is cancelled at PayPal so nobody pays for two plans.
export async function activateFromPayPal(sub: Subscription, expectAccount?: string) {
  const who = parseCustom(sub.custom_id);
  if (!who || (expectAccount && who.accountId !== expectAccount)) return null;
  if (sub.status !== "ACTIVE" && sub.status !== "APPROVED") return null;
  const renewsAt = sub.billing_info?.next_billing_time ?? new Date(Date.now() + 30 * 864e5).toISOString();
  const r = await accountApi("POST", "/v1/internal/plans/activate", { accountId: who.accountId, plan: who.plan, subscriptionId: sub.id, renewsAt });
  if (r.status !== 200) throw new Error(`activate ${r.status}`);
  const previous = (r.body as { previous?: string }).previous;
  if (previous) await cancelSubscription(previous, "Replaced by a new E-Cinema plan").catch(() => console.error("Could not cancel old subscription"));
  return who.plan;
}

export async function endFromPayPal(subscriptionId: string) {
  const r = await accountApi("POST", "/v1/internal/plans/end", { subscriptionId });
  if (r.status !== 200) throw new Error(`end ${r.status}`);
}
