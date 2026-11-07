import { session } from "@/lib/licensing";
import { currentAccount } from "@/lib/auth";
import { execStakeholder } from "@/lib/exec";
import { usdRates } from "@/lib/fx";
import ExecStakeholder from "@/components/exec/ExecStakeholder";
import { uptime } from "@/lib/uptime";

export const metadata = { title: "Stakeholder view · Executive · E-Cinema", robots: { index: false } };
export const dynamic = "force-dynamic";

// Stakeholder view (Figma 83:958): revenue in US dollars at today's rate, rounded on the page.
export default async function StakeholderPage() {
  const [d, me, fx] = await Promise.all([execStakeholder(await session()), currentAccount(), usdRates()]);
  if (!d) return <section className="exc"><h1>E-Cinema this month</h1><p className="exc-sub">This page is for the CEO and stakeholders.</p></section>;
  const usd = (xs: { currency: string; minor: number }[]) => xs.reduce((s, x) => s + (x.currency === "USD" ? x.minor : fx?.[x.currency] ? Math.round(x.minor / fx[x.currency]) : 0), 0);
  return <ExecStakeholder up={await uptime()} d={d} revenue={usd(d.revenue)} revenuePrev={usd(d.revenuePrev)} viewer={me ? `${me.name} · ${me.email}` : ""} />;
}
