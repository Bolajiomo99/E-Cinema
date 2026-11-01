import { Donut, LineChart } from "@/components/licensing/Charts";
import ProductArt from "@/components/store/ProductArt";
import { myLicence, partnerPage, session } from "@/lib/licensing";
import { dateName, short, naira, type Overview } from "@/lib/licensing-types";

// Figma "Licensee / Overview" (116:192).
const TAG: Record<string, string> = { "Best seller": "teal", Rising: "gold", Steady: "grey" };
const ALERT: Record<string, [string, string]> = { action: ["red", "Action"], new: ["teal", "New"], info: ["grey", "Info"] };

function pct(now: number, before: number) {
  if (!before) return now ? "new this month" : "no sales yet";
  const p = Math.round(((now - before) / before) * 100);
  return `${p >= 0 ? "+" : ""}${p}% vs last month`;
}

export default async function PartnerOverview({ searchParams }: { searchParams: Promise<{ welcome?: string }> }) {
  const s = await session();
  const [mine, o, sp] = await Promise.all([myLicence(s), partnerPage<Overview>(s, "overview"), searchParams]);
  if (!mine || !o) return <p className="pt-empty">Your dashboard could not load. Refresh to try again.</p>;
  const l = mine.licensee;
  const hour = Number(new Date().toLocaleString("en-GB", { hour: "numeric", hour12: false, timeZone: "Africa/Lagos" }));
  const hello = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const short4 = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
  const n = o.daily.length;
  const labels = n ? [0, Math.round(n / 3), Math.round((2 * n) / 3), n - 1].map((i) => short4(o.daily[Math.min(i, n - 1)].day)) : [];
  const itemsDiff = o.items - o.itemsPrev;
  return (
    <div className="pt-body">
      <header className="bp-head">
        <div>
          <h1>{hello}, {l.name.replace(/\s+(Ltd|Limited|PLC|Inc)\.?$/i, "")}</h1>
          <p>Live sales of your official E‑Cinema merch · all countries · last 30 days</p>
        </div>
        <a className="vf-btn red" href="/partner/products?new=1">Submit a new product</a>
      </header>
      {sp.welcome && <p className="bp-flash">Welcome. Your licence {l.licence} is active until {dateName(l.validUntil)}. Submit your first product to get it approved.</p>}
      <div className="bp-kpis">
        <div className="bp-kpi"><span>Sales</span><b>{short(o.salesNgn)}</b><em className={o.salesNgn < o.salesPrevNgn ? "neg" : ""}>{pct(o.salesNgn, o.salesPrevNgn)}</em></div>
        <div className="bp-kpi"><span>Items sold</span><b>{o.items.toLocaleString("en-GB")}</b><em className={itemsDiff < 0 ? "neg" : ""}>{itemsDiff >= 0 ? "+" : "−"}{Math.abs(itemsDiff).toLocaleString("en-GB")}</em></div>
        <div className="bp-kpi"><span>Code scans by buyers</span><b>{o.scans.toLocaleString("en-GB")}</b><em>{o.scannedPct}% of items checked</em></div>
        <div className="bp-kpi"><span>Royalty due</span><b>{short(o.royaltyNgn)}</b><em className="muted">{l.plan.royaltyPct}% · due {short4(o.royaltyDue)}</em></div>
      </div>
      <div className="pt-row a">
        <section className="bp-panel">
          <h2>Sales by day</h2>
          <LineChart points={o.daily.map((d) => d.sales)} labels={labels} />
        </section>
        <section className="bp-panel">
          <h2>By channel</h2>
          <Donut parts={o.channels} />
        </section>
      </div>
      <div className="pt-row b">
        <section className="bp-panel">
          <h2>Top products</h2>
          {o.top.length ? o.top.map((t) => (
            <div key={t.id} className="pt-v tall">
              <ProductArt id={/hood/i.test(t.name) ? "premiere-hoodie" : /cap/i.test(t.name) ? "premiere-cap" : /tote|bag/i.test(t.name) ? "tote-bag" : /umbrella/i.test(t.name) ? "umbrella" : "logo-tshirt"} name="" className="pt-photo" size={30} />
              <div><b>{t.name}</b><small>{t.sold.toLocaleString("en-GB")} sold · {naira(t.priceNgn)}</small></div>
              <span className={`bp-pill ${TAG[t.tag] ?? "grey"}`}>{t.tag}</span>
            </div>
          )) : <p className="pt-empty">Your approved products and their sales show here. <a href="/partner/products?new=1">Submit a product</a></p>}
        </section>
        <section className="bp-panel">
          <h2>Alerts</h2>
          {o.alerts.length ? o.alerts.map((a) => (
            <div key={a.title} className="pt-v">
              <div><b>{a.title}</b><small>{a.detail}</small></div>
              {a.kind === "info" && a.link === "/partner/licence" ? <a className="vf-btn soft sm" href="/partner/licence">Renew</a> : <a className={`bp-pill ${ALERT[a.kind][0]}`} href={a.link}>{ALERT[a.kind][1]}</a>}
            </div>
          )) : <p className="pt-empty">Nothing needs you right now.</p>}
        </section>
      </div>
    </div>
  );
}
