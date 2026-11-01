import Link from "next/link";
import { Bars, Columns } from "@/components/licensing/Charts";
import { AnalyticsExport, RecordSales } from "@/components/licensing/AnalyticsTools";
import { accountApi } from "@/lib/auth";
import { myLicence, partnerPage, session } from "@/lib/licensing";
import { naira, short, type Analytics, type Product } from "@/lib/licensing-types";
import { countryName } from "@/lib/worldmap";

// Figma "Licensee / Sales analytics" (116:441).
const PERIODS: [string, string][] = [["30", "30 days"], ["90", "90 days"], ["0", "This year"]];

export default async function PartnerAnalytics({ searchParams }: { searchParams: Promise<{ days?: string; country?: string; product?: string }> }) {
  const sp = await searchParams;
  const days = ["30", "90", "0"].includes(sp.days ?? "") ? sp.days! : "30";
  const country = /^[A-Z]{2}$/.test(sp.country ?? "") ? sp.country! : "";
  const product = (sp.product ?? "").slice(0, 80);
  const s = await session();
  const q = new URLSearchParams({ days, country, product }).toString();
  const [mine, a, pr] = await Promise.all([myLicence(s), partnerPage<Analytics>(s, "analytics", q), accountApi("GET", "/v1/me/partner/products", undefined, s)]);
  if (!mine || !a) return <p className="pt-empty">Analytics could not load. Refresh to try again.</p>;
  const live = pr.status === 200 ? (pr.body as { products: Product[] }).products.filter((p) => p.status === "live") : [];
  const href = (k: string, v: string) => `/partner/analytics?${new URLSearchParams({ days, country, product, [k]: v }).toString()}`;
  const avgDiff = a.avgOrderPrev ? Math.round(((a.avgOrderNgn - a.avgOrderPrev) / a.avgOrderPrev) * 100) : 0;
  // 14:00 to 01:00 Lagos time, the premiere-night window in the design.
  const hours = Array.from({ length: 12 }, (_, i) => a.premiereHours[(14 + i) % 24]);
  const where = country ? countryName(country) : "all countries";
  return (
    <div className="pt-body">
      <header className="bp-head">
        <div>
          <h1>Sales analytics</h1>
          <p>Where, when and how your E‑Cinema merch sells</p>
        </div>
        <div className="pt-btns">
          <RecordSales products={live.map((p) => p.name)} countries={mine.licensee.countries} />
          <AnalyticsExport a={a} label={`${PERIODS.find((p) => p[0] === days)![1]} · ${where}${product ? ` · ${product}` : ""}`} />
        </div>
      </header>
      <div className="bp-chips pt-filters" aria-label="Filters">
        {PERIODS.map(([v, label]) => <Link key={v} href={href("days", v)} className={days === v ? "on" : ""} aria-current={days === v ? "true" : undefined}>{label}</Link>)}
        <details className="pt-pick">
          <summary className={country ? "on" : "on soft"}>{country ? countryName(country) : "All countries"}</summary>
          <div>
            <Link href={href("country", "")}>All countries</Link>
            {[...new Set([...mine.licensee.countries, ...a.countries])].map((c) => <Link key={c} href={href("country", c)}>{countryName(c)}</Link>)}
          </div>
        </details>
        <details className="pt-pick">
          <summary className={product ? "on" : "on soft"}>{product || "All products"}</summary>
          <div>
            <Link href={href("product", "")}>All products</Link>
            {[...new Set([...live.map((p) => p.name), ...a.products])].map((p) => <Link key={p} href={href("product", p)}>{p}</Link>)}
          </div>
        </details>
      </div>
      <div className="bp-kpis">
        <div className="bp-kpi"><span>Average order</span><b>{naira(a.avgOrderNgn)}</b><em className={avgDiff < 0 ? "neg" : a.avgOrderPrev ? "" : "muted"}>{a.avgOrderPrev ? `${avgDiff >= 0 ? "+" : ""}${avgDiff}%` : `${a.orders.toLocaleString("en-GB")} orders`}</em></div>
        <div className="bp-kpi"><span>Repeat buyers</span><b>{a.repeatPct}%</b><em className="muted">of buyers bought again</em></div>
        <div className="bp-kpi"><span>Premiere-night lift</span><b>{a.premiereLift ? `${a.premiereLift}×` : "–"}</b><em className={a.premiereLift ? "" : "muted"}>sales on film nights</em></div>
        <div className="bp-kpi"><span>Returns</span><b>{a.returnsPct}%</b><em className={a.returnsPct > 5 ? "neg" : "muted"}>{a.returnsPct > 5 ? "high" : "low"}</em></div>
      </div>
      <div className="pt-row c">
        <section className="bp-panel"><h2>Sales by country</h2><Bars rows={a.byCountry.map((r) => ({ ...r, name: countryName(r.name) }))} color="#2bb3a3" format={(r) => short(r.value)} /></section>
        <section className="bp-panel"><h2>Sales by city ({countryName(a.cityCountry)})</h2><Bars rows={a.byCity} color="#e3182d" format={(r) => short(r.value)} /></section>
      </div>
      <div className="pt-row c">
        <section className="bp-panel"><h2>Units by hour on premiere nights</h2><Columns values={hours} from={14} labels={["14:00", "18:00", "22:00", "02:00"]} /></section>
        <section className="bp-panel"><h2>Which films drive sales</h2><Bars rows={a.byFilm} color="#8b7cf6" format={(r) => `${r.pct}%`} /></section>
      </div>
    </div>
  );
}
