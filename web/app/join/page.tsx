import { redirect } from "next/navigation";
import JoinFlow, { type Step } from "@/components/signup/JoinFlow";
import Logo from "@/components/landing/Logo";
import LocalePicker from "@/components/LocalePicker";
import { readLocale } from "@/lib/locale";
import { accountApi, currentAccount, SESSION_COOKIE } from "@/lib/auth";
import { googleEnabled } from "@/lib/google";
import { subscriptionsEnabled } from "@/lib/paypal-subs";
import { currencyFor } from "@/lib/plans";
import { cookies } from "next/headers";

export const metadata = { title: "Join · E-Cinema" };
export const dynamic = "force-dynamic";

const ART: Record<number, [string, string]> = {
  1: ["YOUR SEAT\nIS WAITING", "Join free. Upgrade when you want to talk, request older films or bring the whole group."],
  2: ["ONE PERSON,\nONE SEAT", "No shared logins, no bots buying up premieres. That is how we keep tickets fair."],
  3: ["LOUDER\nTOGETHER", "Talk in every room, request classics and bring the whole group. Switch or cancel any time."],
  4: ["PAY YOUR\nWAY", "PayPal, cards and local methods. Cancel any time, and your seat stays yours."],
};

export default async function JoinPage({ searchParams }: { searchParams: Promise<{ step?: string; plan?: string; failed?: string; cancelled?: string; cycle?: string }> }) {
  const [me, loc, sp] = await Promise.all([currentAccount(), readLocale(), searchParams]);
  const asked = Number(sp.step);
  let step: Step = me ? ((asked >= 2 && asked <= 4 ? asked : sp.plan ? 3 : 2) as Step) : 1;
  let profile: { country?: string; contactPhone?: string; plan?: "free" | "student" | "pro" | "vip" | "enterprise"; planStatus?: string; pendingPlan?: "student" | "pro" | "vip" | "enterprise" } | undefined;
  if (me) {
    const session = (await cookies()).get(SESSION_COOKIE)?.value;
    const r = await accountApi("GET", "/v1/me/profile", undefined, session);
    if (r.status === 200) profile = r.body as typeof profile;
    if (step === 4 && !profile?.pendingPlan && (!profile?.plan || profile.plan === "free")) step = 3;
  } else if (sp.step) {
    redirect(sp.plan ? `/join?plan=${encodeURIComponent(sp.plan)}` : "/join");
  }
  const country = profile?.country || loc.country;
  const ready = {
    paypal: subscriptionsEnabled(),
    paystack: Boolean(process.env.PAYSTACK_SECRET_KEY),
    flutterwave: Boolean(process.env.FLUTTERWAVE_SECRET_KEY),
    crypto: Boolean(process.env.COINBASE_COMMERCE_API_KEY),
  };
  const art = ART[step];
  const cur = currencyFor(country);
  return (
    <main className={`su ${art ? "split" : "solo"}`}>
      {art ? (
        <aside className="su-art" aria-hidden>
          <span className="su-glow" />
          <div className="su-posters">
            <span className="su-poster a"><b>ORBIT<br />ZERO</b></span>
            <span className="su-poster b"><b>MONSOON<br />HEARTS</b></span>
            <span className="su-poster c" />
          </div>
          <span className="su-fade" />
          <div className="su-art-logo"><Logo /></div>
          <div className="su-art-copy">
            <h2>{art[0]}</h2>
            <p>{art[1]}</p>
          </div>
        </aside>
      ) : (
        <header className="su-top">
          <Logo />
          <span className="su-top-r"><LocalePicker country={loc.country} homeCountry={profile?.country} lang={loc.lang} signedIn={Boolean(me)} /><span className="lp-chip static">{cur === "NGN" ? "₦ NGN" : cur === "EUR" ? "€ EUR" : "$ USD"}</span></span>
        </header>
      )}
      <div className="su-panel">
        <div className="su-phone-logo"><Logo /></div>
        <JoinFlow
          step={step}
          country={country}
          profile={profile}
          identityStatus={me?.faceVerified ? "approved" : undefined}
          email={me?.email}
          emailVerified={me?.emailVerified !== false}
          google={googleEnabled}
          ready={ready}
          wanted={sp.plan}
          notice={sp.failed ? "failed" : sp.cancelled ? "cancelled" : undefined}
          cycle={sp.cycle === "year" ? "year" : "month"}
        />
      </div>
    </main>
  );
}
