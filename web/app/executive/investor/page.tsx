import { session } from "@/lib/licensing";
import { currentAccount } from "@/lib/auth";
import { execInvestor } from "@/lib/exec";
import { usdRates } from "@/lib/fx";
import { priceOf, type PlanId } from "@/lib/plans";
import ExecInvestor, { type InvestorView } from "@/components/exec/ExecInvestor";

export const metadata = { title: "Investor view · Executive · E-Cinema", robots: { index: false } };
export const dynamic = "force-dynamic";

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function nowMs() {
  return Date.now();
}

// Investor view (Figma 50:609): everything in US dollars at today's rate, aggregated, no personal data.
export default async function InvestorPage() {
  const [d, me, fx] = await Promise.all([execInvestor(await session()), currentAccount(), usdRates()]);
  if (!d) return <section className="exc"><h1>E-Cinema for investors</h1><p className="exc-sub">This page is for the CEO, the CFO and investors.</p></section>;
  const missing = new Set<string>();
  const usd = (minor: number, cur: string) => {
    if (cur === "USD") return minor;
    const r = fx?.[cur];
    if (!r) { missing.add(cur); return 0; }
    return Math.round(minor / r);
  };
  const total = (xs: { currency: string; minor: number }[]) => xs.reduce((s, x) => s + usd(x.minor, x.currency), 0);
  // The last 12 Lagos months, oldest first, with empty months kept.
  const now = new Date(nowMs() + 3600_000);
  const months = Array.from({ length: 12 }, (_, i) => {
    const t = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 11 + i, 1));
    const key = `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}`;
    return { label: MON[t.getUTCMonth()][0], name: `${MON[t.getUTCMonth()]} ${t.getUTCFullYear()}`, usd: d.months.filter((m) => m.month === key).reduce((s, m) => s + usd(m.net, m.currency), 0) };
  });
  const paying = Object.values(d.paying).reduce((s, n) => s + n, 0);
  const planValue = Object.entries(d.paying).reduce((s, [p, n]) => s + Math.round(priceOf(p as PlanId, "USD") * 100) * n, 0);
  const v: InvestorView = {
    net30: total(d.net30), netPrev30: total(d.netPrev30), gross30: total(d.gross30), studio30: total(d.studio30),
    buyers30: d.buyers30, members: d.members, paying, planValue, months, milestones: d.milestones, canEdit: d.canEdit,
    viewer: me ? `${me.name} · ${me.email}` : "", missing: [...missing],
  };
  return <ExecInvestor v={v} />;
}
