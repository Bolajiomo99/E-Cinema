import "server-only";
import { accessToken, base } from "@/lib/paypal-webhook";
import { PLANS, priceOf, VIP_TIERS, YEARLY_SAVING, type Currency, type Cycle, type PlanId } from "@/lib/plans";

// Paid plans are PayPal subscriptions (Billing Plans + Subscriptions REST APIs).
// The product and one billing plan per plan and currency are created on first use and found
// again by name afterwards, so nothing has to be set up by hand in the PayPal dashboard.
// PayPal does not settle in naira, so Nigerian members are billed the USD price.

const PRODUCT_NAME = "E-Cinema membership";
export const billingCurrency = (c: Currency): "USD" | "EUR" => (c === "EUR" ? "EUR" : "USD");

async function pp<T>(path: string, init: RequestInit & { idem?: string } = {}): Promise<T> {
  const res = await fetch(`${base()}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${await accessToken()}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
      ...(init.idem ? { "PayPal-Request-Id": init.idem } : {}),
    },
    signal: AbortSignal.timeout(15000),
    cache: "no-store",
  });
  if (!res.ok) {
    console.error("PayPal subscriptions", path.split("?")[0], res.status);
    throw new Error(`PayPal ${res.status}`);
  }
  return (res.status === 204 ? undefined : await res.json()) as T;
}

let productId: string | undefined;
const planIds = new Map<string, string>();

async function product(): Promise<string> {
  if (productId) return productId;
  const list = await pp<{ products?: { id: string; name: string }[] }>("/v1/catalogs/products?page_size=20");
  productId = list.products?.find((p) => p.name === PRODUCT_NAME)?.id;
  if (!productId) {
    const p = await pp<{ id: string }>("/v1/catalogs/products", {
      method: "POST",
      idem: "ec-product-membership-v1",
      body: JSON.stringify({ name: PRODUCT_NAME, description: "Premiere access plans for E-Cinema", type: "SERVICE", home_url: "https://e-cinema.net" }),
    });
    productId = p.id;
  }
  return productId;
}

const planName = (plan: PlanId, cur: string, cycle: Cycle) => `E-Cinema ${PLANS.find((p) => p.id === plan)!.name} · ${cur} · ${cycle === "year" ? "yearly" : "monthly"} · v2`;

export async function billingPlan(plan: PlanId, currency: Currency, cycle: Cycle = "month"): Promise<string> {
  const cur = billingCurrency(currency);
  const name = planName(plan, cur, cycle);
  const hit = planIds.get(name);
  if (hit) return hit;
  const prod = await product();
  for (let page = 1; page <= 5; page++) {
    const list = await pp<{ plans?: { id: string; name: string; status: string }[]; total_pages?: number }>(
      `/v1/billing/plans?product_id=${prod}&page_size=20&page=${page}&total_required=true`,
    );
    for (const p of list.plans ?? []) if (p.status === "ACTIVE") planIds.set(p.name, p.id);
    if (planIds.has(name) || page >= (list.total_pages ?? 1)) break;
  }
  if (!planIds.has(name)) {
    const yearly = (v: number) => (cycle === "year" ? Math.round(v * 12 * (1 - YEARLY_SAVING) * 100) / 100 : v);
    // VIP is priced per seat in volume tiers: the tier the group size falls in sets every seat's price.
    const pricing_scheme = plan === "vip"
      ? { pricing_model: "VOLUME", tiers: VIP_TIERS[cur].map(([a, b, v]) => ({ starting_quantity: String(a), ending_quantity: String(b), amount: { value: yearly(v).toFixed(2), currency_code: cur } })) }
      : { fixed_price: { value: priceOf(plan, cur, cycle).toFixed(2), currency_code: cur } };
    const created = await pp<{ id: string }>("/v1/billing/plans", {
      method: "POST",
      idem: `ec-plan-${plan}-${cur}-${cycle}-v2`,
      body: JSON.stringify({
        product_id: prod,
        name,
        description: PLANS.find((p) => p.id === plan)!.blurb.slice(0, 127),
        status: "ACTIVE",
        quantity_supported: plan === "vip",
        billing_cycles: [{
          frequency: { interval_unit: cycle === "year" ? "YEAR" : "MONTH", interval_count: 1 },
          tenure_type: "REGULAR",
          sequence: 1,
          total_cycles: 0,
          pricing_scheme,
        }],
        payment_preferences: { auto_bill_outstanding: true, setup_fee_failure_action: "CANCEL", payment_failure_threshold: 2 },
      }),
    });
    planIds.set(name, created.id);
  }
  return planIds.get(name)!;
}

export type Subscription = {
  id: string;
  status: "APPROVAL_PENDING" | "APPROVED" | "ACTIVE" | "SUSPENDED" | "CANCELLED" | "EXPIRED";
  custom_id?: string;
  plan_id: string;
  quantity?: string;
  billing_info?: { next_billing_time?: string };
  links?: { href: string; rel: string }[];
};

// custom_id carries "<account id>:<plan>" so the return page and the webhook can both check it.
export async function createSubscription(opts: { accountId: string; plan: PlanId; currency: Currency; cycle?: Cycle; seats?: number; origin: string; email?: string; taxPercent?: number }) {
  const planId = await billingPlan(opts.plan, opts.currency, opts.cycle);
  const sub = await pp<Subscription>("/v1/billing/subscriptions", {
    method: "POST",
    body: JSON.stringify({
      plan_id: planId,
      ...(opts.plan === "vip" ? { quantity: String(Math.min(50, Math.max(5, opts.seats ?? 5))) } : {}),
      custom_id: `${opts.accountId}:${opts.plan}`,
      // VAT for the viewer's country is added on top, matching the summary on the Pay step.
      ...(opts.taxPercent ? { plan: { taxes: { percentage: opts.taxPercent.toFixed(2), inclusive: false } } } : {}),
      ...(opts.email ? { subscriber: { email_address: opts.email } } : {}),
      application_context: {
        brand_name: "E-Cinema",
        user_action: "SUBSCRIBE_NOW",
        shipping_preference: "NO_SHIPPING",
        return_url: `${opts.origin}/api/paypal/subscriptions/return`,
        cancel_url: `${opts.origin}/join?step=4&cancelled=1`,
      },
    }),
  });
  const approve = sub.links?.find((l) => l.rel === "approve")?.href;
  if (!approve) throw new Error("PayPal gave no approval link");
  return { id: sub.id, approve };
}

export const getSubscription = (id: string) => pp<Subscription>(`/v1/billing/subscriptions/${encodeURIComponent(id)}`);

export async function cancelSubscription(id: string, reason: string) {
  try {
    await pp(`/v1/billing/subscriptions/${encodeURIComponent(id)}/cancel`, { method: "POST", body: JSON.stringify({ reason: reason.slice(0, 127) }) });
  } catch (e) {
    // Already cancelled or expired subscriptions answer 422; that is the state we wanted.
    if (!(e instanceof Error && e.message === "PayPal 422")) throw e;
  }
}

export function parseCustom(custom?: string): { accountId: string; plan: PlanId } | null {
  const m = /^([0-9a-f-]{36}):(student|pro|vip|enterprise)$/.exec(custom ?? "");
  return m ? { accountId: m[1], plan: m[2] as PlanId } : null;
}

export const subscriptionsEnabled = () => Boolean(process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_CLIENT_SECRET);
