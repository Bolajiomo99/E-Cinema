import { session } from "@/lib/licensing";
import { commandCenter, execContent, execHiring, execInfra, execLicensing, execOverview, execSecurity } from "@/lib/exec";
import { convert } from "@/lib/fx";
import { uptime } from "@/lib/uptime";
import ExecOverview, { type OverviewView } from "@/components/exec/ExecOverview";

// The 12 Mondays (Lagos time) the weekly chart covers, oldest first, so quiet weeks still show.
function lastMondays(): string[] {
  const l = new Date(Date.now() + 3600_000);
  const monday = Date.UTC(l.getUTCFullYear(), l.getUTCMonth(), l.getUTCDate()) - ((l.getUTCDay() + 6) % 7) * 86_400_000;
  return Array.from({ length: 12 }, (_, i) => new Date(monday - (11 - i) * 7 * 86_400_000).toISOString().slice(0, 10));
}

export const metadata = { title: "Everything, right now · Executive · E-Cinema", robots: { index: false } };
export const dynamic = "force-dynamic";

// CEO global overview (Figma 117:684): one screen with every live number, CEO only.
// All money is shown in naira, converted at today's rate.
export default async function OverviewPage() {
  const s = await session();
  const [cc, ov, infra, sec, hiring, lic, content, up] = await Promise.all([commandCenter(s), execOverview(s), execInfra(s), execSecurity(s), execHiring(s), execLicensing(s), execContent(s), uptime()]);
  if (!cc || !ov || cc.command.role !== "ceo") {
    return <section className="exc"><h1>Everything, right now</h1><p className="exc-sub">This overview is for the CEO only. Your pages are in the menu.</p></section>;
  }
  const ngn = async (minor: number, cur: string) => Math.round(((await convert(minor / 100, cur, "NGN")) ?? 0));
  const weekKeys = lastMondays();
  const weeks: OverviewView["weeks"] = [];
  for (const wk of weekKeys) {
    const row: Record<string, number> = {};
    for (const w of ov.weeks.filter((x) => x.week === wk)) row[w.stream] = (row[w.stream] ?? 0) + await ngn(w.gross, w.currency);
    weeks.push({ week: wk, streams: row });
  }
  const month: Record<string, number> = {};
  for (const m of ov.month) month[m.stream] = (month[m.stream] ?? 0) + await ngn(m.gross, m.currency);
  const c = cc.command;
  const v: OverviewView = {
    revenueToday: await ngn(c.revenueToday, "USD"), revenueWeekAgo: await ngn(c.revenueWeekAgo, "USD"),
    revenue30: await ngn(c.revenue30, "USD"), revenuePrev30: await ngn(c.revenuePrev30, "USD"),
    watching: cc.online, peakToday: infra?.peakToday ?? null, members: c.members, membersToday: ov.membersToday,
    countries: c.countries, countriesNew: c.countriesNew,
    studios: content?.studios ?? c.studios, studiosWaiting: content?.studiosWaiting ?? null,
    partners: lic?.partners ?? null, royaltyNgn: lic?.royaltyNgn ?? null,
    openRoles: hiring?.open ?? null, openNg: hiring?.openNg ?? 0, ngTarget: hiring?.ngShare ?? 40,
    blockedToday: sec?.blockedToday ?? null, breaches: sec?.breaches ?? 0, openCritical: sec?.openCritical ?? null,
    weeks, month,
    spots: (cc.onlineByCountry.length ? cc.onlineByCountry.map((x) => ({ cc: x.country, v: x.watching })) : c.watching.map((x) => ({ cc: x.country, v: x.seats }))),
    live: cc.onlineByCountry.length > 0,
    p50Ms: infra?.p50Ms ?? null, p99Ms: infra?.p99Ms ?? null, dbConns: infra?.dbConns ?? null, dbMaxConns: infra?.dbMaxConns ?? null,
    backups: infra?.backups ?? [], decisions: c.decisions, uptime30: up?.month ?? null,
  };
  return <ExecOverview v={v} />;
}
