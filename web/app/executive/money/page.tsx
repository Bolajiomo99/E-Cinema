import { session } from "@/lib/licensing";
import { execMoney } from "@/lib/exec";
import { usdRates } from "@/lib/fx";
import ExecMoney, { type MoneyView } from "@/components/exec/ExecMoney";

export const metadata = { title: "Money · Executive · E-Cinema", robots: { index: false } };

// Regions for the net revenue chart, by the buyer's home country.
const REGION: Record<string, string> = {};
const put = (r: string, cc: string) => cc.split(" ").forEach((c) => { REGION[c] = r; });
put("W. Africa", "NG GH SN CI BJ TG SL LR GM BF ML NE GN CV");
put("E. Africa", "KE UG TZ RW ET SO SS BI DJ ER");
put("S. Africa", "ZA ZW ZM BW NA MZ MW LS SZ AO MG MU");
put("C. & N. Africa", "CM CD CG GA TD CF GQ EG MA DZ TN LY SD");
put("Europe", "GB IE FR DE ES PT IT NL BE CH AT SE NO DK FI PL CZ GR RO HU UA");
put("N. America", "US CA");
put("LatAm", "MX BR AR CO CL PE VE EC JM TT");
put("Asia", "IN PK BD LK NP CN JP KR ID PH VN TH MY SG");
put("Middle East", "AE SA QA KW TR IL JO LB");

const SOURCES: [string, string][] = [["tickets", "Studio ticket fee (30%)"], ["presales", "Coming-soon pre-sales"], ["shop", "Shop and merch"], ["gifts", "Gift tickets"], ["library", "Keep forever"], ["licences", "Merch licences"], ["adult", "18+ access (to the funds)"]];

export default async function Money({ searchParams }: { searchParams: Promise<{ days?: string }> }) {
  const days = [30, 90, 365].includes(Number((await searchParams).days)) ? Number((await searchParams).days) : 30;
  const m = await execMoney(await session(), days);
  if (!m) return <section className="exc"><h1>Money</h1><p className="exc-sub">Money is open to the CEO, the CFO and people the CEO allows to see it.</p></section>;
  const fx = await usdRates();
  const missing = new Set<string>();
  // US cents from minor units of any currency, at today's rate.
  const usd = (minor: number, cur: string) => {
    if (cur === "USD") return minor;
    const r = fx?.[cur];
    if (!r) { missing.add(cur); return 0; }
    return Math.round(minor / r);
  };
  const by = (prev: boolean, f: "gross" | "net") => m.rows.filter((r) => r.prev === prev).reduce((s, r) => s + usd(r[f], r.currency), 0);
  const sources = SOURCES.map(([k, label]) => ({ key: k, label, net: m.rows.filter((r) => !r.prev && r.source === k).reduce((s, r) => s + usd(k === "adult" ? r.gross : r.net, r.currency), 0) }));
  const regions = new Map<string, number>();
  for (const r of m.regions) {
    const k = REGION[r.country] ?? (r.country === "??" ? "Unknown" : "Other");
    regions.set(k, (regions.get(k) ?? 0) + usd(r.net, r.currency));
  }
  const prov = new Map<string, { volume: number; paid: number; tried: number; refunded: number; countries: Set<string> }>();
  for (const p of m.providers) {
    const x = prov.get(p.provider) ?? { volume: 0, paid: 0, tried: 0, refunded: 0, countries: new Set<string>() };
    x.volume += p.currency ? usd(p.volume, p.currency) : 0;
    // Seat checkouts come once per provider (with no currency when nothing was paid).
    if (p.tried > x.tried) { x.paid = p.paid; x.tried = p.tried; x.refunded = p.refunded; }
    p.countries.forEach((c) => x.countries.add(c));
    prov.set(p.provider, x);
  }
  const orig = new Map<string, number>();
  for (const r of m.rows) if (!r.prev) orig.set(r.currency, (orig.get(r.currency) ?? 0) + r.gross);
  const view: MoneyView = {
    days,
    gross: by(false, "gross"), grossPrev: by(true, "gross"), net: by(false, "net"), netPrev: by(true, "net"),
    refunds: m.refunds,
    sources: sources.filter((s) => s.net > 0),
    regions: [...regions.entries()].map(([region, net]) => ({ region, net })).filter((r) => r.net > 0).sort((a, b) => (a.region === "Unknown" ? 1 : 0) - (b.region === "Unknown" ? 1 : 0) || b.net - a.net),
    providers: ["paystack", "flutterwave", "paypal", "cash"].map((k) => ({ key: k, ...(prov.get(k) ?? { volume: 0, paid: 0, tried: 0, refunded: 0, countries: new Set<string>() }) }))
      .map((p) => ({ key: p.key, volume: p.volume, paid: p.paid, tried: p.tried, refunded: p.refunded, countries: [...p.countries].sort() })),
    out: [
      { label: "Studio payouts (70%)", usd: m.out.filter((o) => o.what === "studios").reduce((s, o) => s + usd(o.minor, o.currency), 0) },
      { label: "18+ recipient funds", usd: m.out.filter((o) => o.what === "recipients").reduce((s, o) => s + usd(o.minor, o.currency), 0) },
    ],
    original: [...orig.entries()].map(([currency, minor]) => ({ currency, minor })).sort((a, b) => b.minor - a.minor),
    missing: [...missing],
  };
  return <ExecMoney v={view} />;
}
