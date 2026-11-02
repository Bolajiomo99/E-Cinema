import Link from "next/link";
import type { LicensingData } from "@/lib/exec";
import { countryName } from "@/lib/worldmap";

// Licensing (Figma 117:1481): licensed merch partners, their fees, royalties and sales.
const PLAN: Record<string, [string, string]> = { starter: ["Starter", "#8b7cf6"], growth: ["Growth", "#2bb3a3"], global: ["Global", "#e3182d"] };
const STATUS: Record<string, [string, string]> = { active: ["Active", "ok"], suspended: ["Suspended", "bad"], ended: ["Ended", ""] };
const ngn = (v: number) => (v >= 1e6 ? `₦${(v / 1e6).toFixed(1)}M` : v >= 1e4 ? `₦${Math.round(v / 1e3)}k` : `₦${v.toLocaleString("en-NG")}`);

export default function ExecLicensing({ d }: { d: LicensingData }) {
  const growth = d.feesPrevNgn ? Math.round(((d.feesYearNgn - d.feesPrevNgn) / d.feesPrevNgn) * 100) : null;
  const byCountry = Object.entries(d.byCountry).sort((a, b) => b[1] - a[1]);
  const peak = Math.max(1, ...byCountry.map((c) => c[1]));
  const plans = Object.keys(PLAN).map((k) => [k, d.plans[k] ?? 0] as const);
  const total = plans.reduce((s, p) => s + p[1], 0);
  const R = 56, C = 2 * Math.PI * R;
  let off = 0;
  return (
    <section className="exc exl">
      <header className="exc-head">
        <div>
          <h1>Licensing</h1>
          <p className="exc-sub">Companies licensed to make and sell E-Cinema merch, and what they pay us.</p>
        </div>
        <div className="epf-acts">
          <Link href="/licensing" className="exa-ghost exn-btn">Licence plans and prices</Link>
          <Link href="/licensing/desk" className="exa-red exn-btn">Review applications {d.applications > 0 && <i className="exl-n">{d.applications}</i>}</Link>
        </div>
      </header>

      <div className="exc-tiles exg-tiles">
        <div className="exc-tile"><span>Licensed partners</span><b>{d.partners}</b><small>{d.countries} {d.countries === 1 ? "country" : "countries"}</small></div>
        <div className="exc-tile"><span>Licence fees this year</span><b>{ngn(d.feesYearNgn)}</b><small className={growth !== null && growth < 0 ? "down" : "up"}>{growth === null ? (d.feesYearNgn ? "first year of fees" : "none paid yet") : `${growth >= 0 ? "+" : ""}${growth}% on last year`}</small></div>
        <div className="exc-tile"><span>Royalties this month</span><b>{ngn(d.royaltyNgn)}</b><small>5 to 8% of sales</small></div>
        <div className="exc-tile"><span>Partner sales this month</span><b>{ngn(d.salesNgn)}</b><small>returns not counted</small></div>
      </div>

      <div className="exc-row exl-row">
        <div className="exc-card">
          <h2>Partners by country</h2>
          {byCountry.length === 0 && <p className="exc-empty">No active partners yet.</p>}
          {byCountry.slice(0, 8).map(([cc, n]) => (
            <div key={cc} className="exf-sig exh-bar"><span>{countryName(cc)}</span><i><em style={{ width: `${(n / peak) * 100}%`, background: "#e3182d" }} /></i><b>{n}</b></div>
          ))}
        </div>
        <div className="exc-card">
          <h2>Plans</h2>
          <div className="exl-donut">
            <svg viewBox="0 0 140 140" role="img" aria-label={plans.map(([k, n]) => `${PLAN[k][0]} ${n}`).join(", ")}>
              <circle cx="70" cy="70" r={R} fill="none" stroke="#26262e" strokeWidth="18" />
              {total > 0 && plans.map(([k, n]) => {
                const len = (n / total) * C;
                const el = <circle key={k} cx="70" cy="70" r={R} fill="none" stroke={PLAN[k][1]} strokeWidth="18" strokeDasharray={`${len} ${C - len}`} strokeDashoffset={-off} transform="rotate(-90 70 70)" />;
                off += len;
                return el;
              })}
              <text x="70" y="68" textAnchor="middle" fill="#fff" fontSize="24" fontWeight="700">{total}</text>
              <text x="70" y="88" textAnchor="middle" fill="#8a8a96" fontSize="11">partners</text>
            </svg>
            <ul>
              {plans.map(([k, n]) => <li key={k}><i style={{ background: PLAN[k][1] }} />{PLAN[k][0]}<b>{n}</b></li>)}
            </ul>
          </div>
        </div>
      </div>

      <div className="exc-card">
        <h2>Partners</h2>
        {d.rows.length === 0 ? <p className="exc-empty">No licensed partners yet.</p> : (
          <div className="exn-table" role="table" aria-label="Partners">
            <div className="exn-th exl-g" role="row"><span>Partner</span><span>Country</span><span>Plan</span><span>Sales, 30 days</span><span>Compliance</span><span>Status</span></div>
            {d.rows.map((r) => (
              <div key={r.licence} className="exn-tr exl-g" role="row">
                <span className="exl-name"><b>{r.name}</b><small>{r.licence}</small></span>
                <span>{countryName(r.country, true)}</span>
                <span>{PLAN[r.plan]?.[0] ?? r.plan}</span>
                <span>{ngn(r.sales30Ngn)}</span>
                <span className="exl-score"><i><em style={{ width: `${r.compliance}%`, background: r.compliance >= 80 ? "#2bb3a3" : r.compliance >= 60 ? "#e8b34b" : "#e3182d" }} /></i>{r.compliance}</span>
                <span><i className={`exl-st ${STATUS[r.status]?.[1] ?? ""}`}>{STATUS[r.status]?.[0] ?? r.status}</i></span>
              </div>
            ))}
          </div>
        )}
        <p className="epf-hint">Compliance drops for live products without a sample, late or missing royalty payments and rejected designs. Partners are managed on the <Link href="/licensing/desk">licensing desk</Link> (staff).</p>
      </div>
    </section>
  );
}
