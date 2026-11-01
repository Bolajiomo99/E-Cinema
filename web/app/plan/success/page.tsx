import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import Logo from "@/components/landing/Logo";
import { accountApi, currentAccount, SESSION_COOKIE } from "@/lib/auth";
import { PLANS, type PlanId } from "@/lib/plans";

// Plan version of "Payment success" (Figma 29:590), shown after PayPal approves a subscription.
export const dynamic = "force-dynamic";
export const metadata = { title: "Plan confirmed · E-Cinema" };

const PERKS: Record<PlanId, string[]> = {
  free: [],
  student: ["Talk in every room", "Voice notes, images and documents", "2 premieres a month included"],
  pro: ["Talk freely in every room", "Voice notes, images and documents", "Request older films"],
  vip: ["Seats for your whole group", "Group room and host tools", "Lower price per seat"],
  enterprise: ["Private and invite-only screenings", "Private rooms", "Priority support"],
};

export default async function PlanSuccess() {
  const me = await currentAccount();
  if (!me) redirect("/signin?next=/settings/plan");
  const session = (await cookies()).get(SESSION_COOKIE)?.value;
  const r = await accountApi("GET", "/v1/me/profile", undefined, session);
  const profile = (r.status === 200 ? r.body : {}) as { plan?: PlanId; planStatus?: string; renewsAt?: string };
  if (!profile.plan || profile.plan === "free" || profile.planStatus !== "active") redirect("/settings/plan");
  const plan = PLANS.find((p) => p.id === profile.plan)!;
  const renews = profile.renewsAt ? new Date(profile.renewsAt).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }) : "";
  return (
    <main className="ok-page">
      <div className="ok-top"><Logo /></div>
      <span className="ok-check" aria-hidden>
        <svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
      </span>
      <h1>You are on {plan.name}</h1>
      <p className="ok-lead">PayPal confirmed your subscription. Your new plan works in every room straight away.</p>
      <article className="ok-ticket plan">
        <div className={`ok-plan-art ${plan.id}`} aria-hidden><span className={`su-badge ${plan.id}`}>{plan.badge}</span><b>{plan.name.toUpperCase()}</b></div>
        <div className="ok-info">
          <div className="tk-badges"><span className="b white">PLAN ACTIVE</span><span className="b out">PAYPAL</span></div>
          <h2>{plan.name.toUpperCase()} MEMBER</h2>
          <ul className="ok-perks">{PERKS[plan.id].map((x) => <li key={x}>✓ {x}</li>)}</ul>
          <div className="ok-grid">
            <div><p className="ok-k">Renews</p><p className="ok-v">{renews || "Next month"}</p></div>
            <div><p className="ok-k">Manage</p><p className="ok-v"><Link href="/settings/plan">Plan and payments</Link></p></div>
          </div>
        </div>
      </article>
      <div className="ok-foot">
        <Link href="/home" className="ok-btn red">Go to my home</Link>
      </div>
    </main>
  );
}
