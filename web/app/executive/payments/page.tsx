import { session } from "@/lib/licensing";
import { execPayPal, type CurMinor } from "@/lib/exec";
import { convert } from "@/lib/fx";
import ExecPayPal, { type PayPalView } from "@/components/exec/ExecPayPal";

export const metadata = { title: "PayPal and AI agents · Executive · E-Cinema", robots: { index: false } };
export const dynamic = "force-dynamic";

// PayPal and AI agents (Figma 285:373): the CEO, the CFO and anyone allowed to see money.
// Every amount is converted to USD at today's rate.
export default async function PayPalPage({ searchParams }: { searchParams: Promise<{ days?: string }> }) {
  const asked = Number((await searchParams).days);
  const days = [30, 90, 365].includes(asked) ? asked : 30;
  const d = await execPayPal(await session(), days);
  if (!d) return <section className="exc"><h1>PayPal and AI agents</h1><p className="exc-sub">This page is for the CEO, the CFO and anyone allowed to see money.</p></section>;
  const toUsd = async (minor: number, cur: string) => ((await convert(minor / 100, cur, "USD")) ?? 0);
  const sum = async (xs: CurMinor[]) => { let t = 0; for (const x of xs) t += await toUsd(x.minor, x.currency); return t; };
  const buckets: PayPalView["buckets"] = [];
  for (const b of d.buckets) {
    let row = buckets.find((x) => x.start === b.start);
    if (!row) { row = { start: b.start, checkout: 0, donations: 0 }; buckets.push(row); }
    if (b.product === "checkout" || b.product === "donations") row[b.product] += await toUsd(b.minor, b.currency);
  }
  const films: PayPalView["films"] = [];
  for (const f of d.films) {
    const usd = await toUsd(f.gross, f.currency);
    films.push({ film: f.film, studio: f.studio, seats: f.seats, usd, refundPct: f.seats + f.refunded ? (f.refunded / (f.seats + f.refunded)) * 100 : 0, disputes: f.disputes, payout: usd * 0.7 });
  }
  const v: PayPalView = {
    days, revenue: await sum(d.revenue), revenuePrev: await sum(d.revenuePrev), orders: d.orders, conciergeOrders: d.conciergeOrders, conciergeHolds: d.conciergeHolds,
    refunded: d.refunded, refundedPrev: d.refundedPrev, paidPrev: d.paidPrev, disputesOpen: d.disputesOpen, disputesStake: await sum(d.disputesStake), disputesDue48: d.disputesDue48,
    buckets, monthly: d.monthly, films, watch: d.watch,
  };
  return <ExecPayPal v={v} />;
}
