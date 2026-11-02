import Link from "next/link";
import type { BrandData } from "@/lib/exec";
import { COUNTRIES, MAP_H, MAP_W, countryName, dots, project } from "@/lib/worldmap";

// Brand protection (Figma 117:1216). Reports come from the community rewards page; the rewards desk settles them.
const LAND = dots();
const PLACE: Record<string, string> = { online: "Online listing", social: "Social media", market: "Market", delivered: "Delivered to them" };
const STATUS: Record<string, [string, string]> = { sent: ["New", "new"], checking: ["Investigator checking", "chk"] };
const M = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const day = (iso: string) => { const d = new Date(Date.parse(iso) + 3600_000); /* Lagos dates */ return `${M[d.getUTCMonth()]} ${d.getUTCDate()}`; };
const ngn = (v: number) => (v >= 1e6 ? `₦${(v / 1e6).toFixed(1)}M` : v >= 1e4 ? `₦${Math.round(v / 1e3)}k` : `₦${v.toLocaleString("en-NG")}`);

export default function ExecBrand({ d }: { d: BrandData }) {
  const growth = d.prevMonth ? Math.round(((d.month - d.prevMonth) / d.prevMonth) * 100) : null;
  const spots = Object.entries(d.countries).sort((a, b) => b[1] - a[1]);
  const peak = Math.max(1, ...spots.map((s) => s[1]));
  const W = 600, H = 170;
  const top = Math.max(4, ...d.weeks.map((w) => Math.max(w.reports, w.confirmed)));
  const ceil = Math.ceil(top / 4) * 4;
  const pts = (k: "reports" | "confirmed") => d.weeks.map((w, i) => `${(i / Math.max(1, d.weeks.length - 1)) * W},${H - (w[k] / ceil) * H}`).join(" ");
  return (
    <section className="exc exb">
      <header className="exc-head">
        <div>
          <h1>Brand protection</h1>
          <p className="exc-sub">Fake merch and unlicensed use of the E-Cinema logo, reported by the community and checked by AI.</p>
        </div>
        <div className="epf-acts">
          <Link href="/rewards" className="exa-ghost exn-btn">Reward rules</Link>
          <span className="exr-prev" title="Coming soon">Assign investigator <small>Soon</small></span>
        </div>
      </header>

      <div className="exc-tiles exg-tiles">
        <div className="exc-tile"><span>Reports this month</span><b>{d.month.toLocaleString("en-US")}</b><small className={growth !== null && growth < 0 ? "down" : "up"}>{growth === null ? (d.month ? "first month with reports" : "none yet this month") : `${growth >= 0 ? "+" : ""}${growth}% on last month`}</small></div>
        <div className="exc-tile"><span>Confirmed fakes</span><b>{d.confirmed}</b><small className="up">{d.month ? `${Math.round((d.confirmed / d.month) * 100)}% of reports` : "this month"}</small></div>
        <div className="exc-tile"><span>Taken down</span><b>{d.takenDown}</b><small className="up">{d.takenDown ? `avg ${Math.round(d.avgDays * 10) / 10} days` : "none yet"}</small></div>
        <div className="exc-tile"><span>Rewards paid</span><b>{ngn(d.rewardsNgn)}</b><small>to {d.rewarded} member{d.rewarded === 1 ? "" : "s"}</small></div>
      </div>

      <div className="exc-row exb-row">
        <div className="exc-card">
          <h2>Report queue</h2>
          {d.queue.length === 0 ? <p className="exc-empty">No reports waiting.</p> : (
            <div className="exn-table" role="table" aria-label="Report queue">
              <div className="exn-th exb-g" role="row"><span>Report</span><span>Where</span><span>AI check</span><span>Status</span><span /></div>
              {d.queue.map((q) => (
                <div key={q.id} className="exn-tr exb-g" role="row">
                  <span className="exb-sell">{q.selling}</span>
                  <span>{PLACE[q.place] ?? q.place}{q.country ? `, ${countryName(q.country, true)}` : ""}</span>
                  <span className="exb-ai" title={q.aiNote}>{q.aiNote || "–"}</span>
                  <span><i className={`exb-st ${STATUS[q.status]?.[1] ?? ""}`}>{STATUS[q.status]?.[0] ?? q.status}</i></span>
                  <span><Link href="/rewards/desk" className="exa-edit exn-btn">Open</Link></span>
                </div>
              ))}
            </div>
          )}
          <p className="epf-hint">Reports are settled and rewards paid on the <Link href="/rewards/desk">rewards desk</Link> (staff).</p>
        </div>
        <div className="exc-card">
          <h2>Where fakes are found</h2>
          <svg viewBox={`0 0 ${MAP_W} ${MAP_H}`} className="exc-world" role="img" aria-label={spots.length ? `Most reports: ${countryName(spots[0][0])}` : "No reports yet"}>
            {LAND.map((p, i) => <circle key={i} cx={p.x} cy={p.y} r="2.4" fill="#34343f" />)}
            {spots.map(([cc, n]) => {
              const k = COUNTRIES[cc];
              if (!k) return null;
              const { x, y } = project(k.lat, k.lon);
              const r = 8 + 16 * Math.sqrt(n / peak);
              return <g key={cc}><circle cx={x} cy={y} r={r * 1.8} fill="#e3182d" opacity=".2" /><circle cx={x} cy={y} r={r * 0.55} fill="#e3182d" /></g>;
            })}
          </svg>
          {spots.slice(0, 3).map(([cc, n]) => <div key={cc} className="exf-sig exh-bar"><span>{countryName(cc)}</span><i><em style={{ width: `${(n / Math.max(1, d.total)) * 100}%`, background: "#e3182d" }} /></i><b>{Math.round((n / Math.max(1, d.total)) * 100)}%</b></div>)}
          {d.total > 0 && <div className="exf-sig exh-bar"><span>Online</span><i><em style={{ width: `${(d.online / d.total) * 100}%`, background: "#e3182d" }} /></i><b>{Math.round((d.online / d.total) * 100)}%</b></div>}
          {d.total === 0 && <p className="exc-empty">No reports yet.</p>}
        </div>
      </div>

      <div className="exc-row exb-row">
        <div className="exc-card">
          <div className="exb-chart-h"><h2>Reports and takedowns, 12 weeks</h2><span><i className="dot r" />Reports <i className="dot g" />Takedowns</span></div>
          <svg viewBox={`-34 -8 ${W + 44} ${H + 34}`} className="exb-chart" role="img" aria-label={`${d.weeks.reduce((s, w) => s + w.reports, 0)} reports and ${d.weeks.reduce((s, w) => s + w.confirmed, 0)} takedowns in 12 weeks`}>
            {[0, 0.5, 1].map((f) => <g key={f}><line x1="0" x2={W} y1={H - f * H} y2={H - f * H} stroke="#26262e" /><text x="-8" y={H - f * H + 4} textAnchor="end" fill="#8a8a96" fontSize="11">{Math.round(f * ceil)}</text></g>)}
            <polyline points={pts("reports")} fill="none" stroke="#e3182d" strokeWidth="2.4" strokeLinejoin="round" />
            <polyline points={pts("confirmed")} fill="none" stroke="#2bb3a3" strokeWidth="2.4" strokeLinejoin="round" />
            {d.weeks.map((w, i) => (i % 2 === 0 ? <text key={w.week} x={(i / Math.max(1, d.weeks.length - 1)) * W} y={H + 22} textAnchor="middle" fill="#8a8a96" fontSize="11">{day(w.week)}</text> : null))}
          </svg>
        </div>
        <div className="exc-card">
          <h2>Top reporters</h2>
          {d.topReporters.length === 0 && <p className="exc-empty">No confirmed reports yet.</p>}
          {d.topReporters.map((r, i) => (
            <div key={r.name + i} className="exb-who"><span className={`exb-av a${i}`}>{r.name.split(" ").map((x) => x[0]).join("").slice(0, 2).toUpperCase()}</span><b>{r.name}</b><small>{r.confirmed} confirmed</small></div>
          ))}
          <p className="epf-hint">People who report anonymously are never listed.</p>
        </div>
      </div>
    </section>
  );
}
