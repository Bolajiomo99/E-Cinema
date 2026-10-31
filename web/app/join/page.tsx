import { headers } from "next/headers";
import { redirect } from "next/navigation";
import JoinFlow, { type Step } from "@/components/signup/JoinFlow";
import Logo from "@/components/landing/Logo";
import { accountApi, currentAccount, SESSION_COOKIE } from "@/lib/auth";
import { googleEnabled } from "@/lib/google";
import { currencyFor } from "@/lib/plans";
import { cookies } from "next/headers";

export const metadata = { title: "Join · E-Cinema" };
export const dynamic = "force-dynamic";

const ART: Record<number, [string, string]> = {
  1: ["YOUR SEAT\nIS WAITING", "Join free. Upgrade when you want to talk, request older films or bring the whole group."],
  2: ["ONE PERSON,\nONE SEAT", "No shared logins, no bots buying up premieres. That is how we keep tickets fair."],
};

export default async function JoinPage({ searchParams }: { searchParams: Promise<{ step?: string }> }) {
  const [me, h, sp] = await Promise.all([currentAccount(), headers(), searchParams]);
  const asked = Number(sp.step);
  let step: Step = me ? ((asked >= 2 && asked <= 4 ? asked : 2) as Step) : 1;
  let profile: { country?: string; contactPhone?: string; plan?: "free" | "student" | "pro" | "vip" | "enterprise"; planStatus?: string } | undefined;
  if (me) {
    const session = (await cookies()).get(SESSION_COOKIE)?.value;
    const r = await accountApi("GET", "/v1/me/profile", undefined, session);
    if (r.status === 200) profile = r.body as typeof profile;
    if (step === 4 && (!profile?.plan || profile.plan === "free")) step = 3;
  } else if (sp.step) {
    redirect("/join");
  }
  const ip = h.get("cf-ipcountry");
  const country = profile?.country || (ip && ip !== "XX" && ip !== "T1" ? ip : undefined);
  const ready = {
    paypal: false, // card and PayPal subscriptions switch on with the recurring billing release
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
          <span className="lp-chip static">{country ?? "Global"} · English · {cur === "NGN" ? "₦ NGN" : cur === "EUR" ? "€ EUR" : "$ USD"}</span>
        </header>
      )}
      <div className="su-panel">
        <div className="su-phone-logo"><Logo /></div>
        <JoinFlow
          step={step}
          country={country}
          profile={profile}
          identityStatus={me?.faceVerified ? "approved" : undefined}
          google={googleEnabled}
          ready={ready}
        />
      </div>
    </main>
  );
}
