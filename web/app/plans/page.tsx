import LocalePicker from "@/components/LocalePicker";
import { readLocale } from "@/lib/locale";
import Link from "next/link";
import { cookies } from "next/headers";
import Logo from "@/components/landing/Logo";
import PlanCards from "@/components/plans/PlanCards";
import { accountApi, currentAccount, SESSION_COOKIE } from "@/lib/auth";
import { countryName, currencyFor, money, VIP_TIERS, type PlanId } from "@/lib/plans";

// Built from the Figma frame "Web / Plans · Nigeria (NGN)" (18:426); other countries get their own currency.
export const dynamic = "force-dynamic";
export const metadata = { title: "Plans · E-Cinema" };

const YES = "yes", NO = "no";
const COMPARE: [string, string, string, string, string, string][] = [
  ["Premiere tickets", "Pay per film", "2 / month", "4 / month", "Per seat", "Unlimited"],
  ["Room chat", "Read, react, 5 min talk", YES, YES, YES, YES],
  ["Voice, images, documents", NO, YES, YES, YES, YES],
  ["Request older films", NO, NO, YES, NO, YES],
  ["Watch alone or invite-only", NO, NO, NO, NO, YES],
  ["AI insights dashboard", "Basic", YES, YES, "Group", "Team"],
  ["AI snack critic", "3 / month", YES, YES, YES, YES],
  ["Audio boost to 200%", YES, YES, YES, YES, YES],
  ["Downloads", "Buy per film", "Buy per film", "Buy per film", NO, "Included"],
];

export default async function Plans() {
  const [me, loc] = await Promise.all([currentAccount(), readLocale()]);
  let profile: { country?: string; plan?: PlanId; planStatus?: string; pendingPlan?: PlanId } | undefined;
  if (me) {
    const session = (await cookies()).get(SESSION_COOKIE)?.value;
    const r = await accountApi("GET", "/v1/me/profile", undefined, session);
    if (r.status === 200) profile = r.body as typeof profile;
  }
  const country = profile?.country || loc.country;
  const currency = currencyFor(country);
  const tiers = VIP_TIERS[currency].map(([a, b, v]) => `${money(v, currency)} for ${a} to ${b}`);
  const current = profile ? (profile.planStatus === "active" ? profile.plan ?? "free" : "free") : undefined;

  return (
    <main id="main" className="pl">
      <nav className="pl-nav">
        <Logo />
        <div className="pl-nav-r">
          <LocalePicker country={loc.country} homeCountry={profile?.country} lang={loc.lang} signedIn={Boolean(me)} />
          <Link href={me ? "/home" : "/"} className="state-btn ghost">Back to premieres</Link>
        </div>
      </nav>
      <PlanCards
        country={country}
        countryLabel={countryName(country) || "your country"}
        currency={currency}
        signedIn={Boolean(me)}
        current={current}
        pending={profile?.pendingPlan ?? (profile?.planStatus === "awaiting_payment" ? profile.plan : undefined)}
      />
      <section className="pl-group">
        <div>
          <h2>How VIP group pricing works</h2>
          <p>Seats get cheaper as your group grows: {tiers.slice(0, -1).join(", ")}, {tiers.at(-1)}. One person pays for the whole group.</p>
        </div>
        <Link href={me ? "/plans#vip" : "/join?plan=vip"} className="state-btn">Plan a group night</Link>
      </section>
      <div className="pl-compare" role="table" tabIndex={0} aria-label="Compare plans">
        <div className="pl-tr head" role="row">
          <span role="columnheader" />
          {["Free", "Student", "Pro", "VIP group", "Enterprise"].map((n) => <span key={n} role="columnheader">{n}</span>)}
        </div>
        {COMPARE.map(([label, ...cells]) => (
          <div className="pl-tr" role="row" key={label}>
            <span role="rowheader">{label}</span>
            {cells.map((c, i) => (
              <span role="cell" key={i}>
                {c === YES ? <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="#2fbf71" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-label="Included"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
                  : c === NO ? <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="#8e8e99" strokeWidth="2" strokeLinecap="round" aria-label="Not included"><path d="M6.5 6.5l11 11M17.5 6.5l-11 11" /></svg>
                  : c}
              </span>
            ))}
          </div>
        ))}
      </div>
    </main>
  );
}
