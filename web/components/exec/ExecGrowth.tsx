"use client";
import { useRouter } from "next/navigation";
import type { GrowthData } from "@/lib/exec";
import { countryName } from "@/lib/worldmap";

// Growth and users (Figma 82:409). Every number is live; the visit step of the funnel waits on
// site analytics and says so.
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const PLAN: [string, string, string][] = [["free", "Free", "#6e6e7a"], ["pro", "Pro", "#e3182d"], ["vip", "VIP", "#d4a23a"], ["student", "Student", "#2bb3a3"], ["enterprise", "Enterprise", "#8b7cf6"]];
function k(v: number) {
  if (v >= 1e6) return `${(v / 1e6).toFixed(1).replace(/\.0$/, "")}M`;
  if (v >= 1e4) return `${Math.round(v / 1e3)}K`;
  return v.toLocaleString("en-US");
}
const pct = (a: number, b: number) => (b ? Math.round((a / b) * 1000) / 10 : 0);

export default function ExecGrowth({ g }: { g: GrowthData }) {
  const router = useRouter();
  const go = (days: number, country: string) => router.push(`/executive/growth?days=${days}${country ? `&country=${country}` : ""}`);
  const grew = g.members - g.membersPrev;
  const wow = g.newWeekPrev ? Math.round(((g.newWeek - g.newWeekPrev) / g.newWeekPrev) * 100) : null;
  const max = Math.max(1, ...g.months.map((m) => m.grossCents));
  const W = 440, H = 150;
  const line = g.months.map((m, i) => `${(i / 11) * W},${H - (m.grossCents / max) * (H - 8)}`).join(" ");
  const funnel: [string, number | null][] = [["Visited", null], ["Signed up", g.funnel[0]], ["Verified face + phone", g.funnel[1]], ["Watched a film", g.funnel[2]], ["Paid", g.funnel[3]]];
  const fmax = Math.max(1, g.funnel[0]);
  const plansTotal = Object.values(g.plans).reduce((a, b) => a + b, 0);
  const period = g.days === 7 ? "7 days" : g.days === 30 ? "30 days" : "90 days";

  function exportCsv() {
    const rows: (string | number)[][] = [["E-Cinema growth", `last ${period}`, g.country ? countryName(g.country) : "All countries"], [], ["Members", g.members], ["Daily active", g.daily], ["New this week", g.newWeek], ["Paying members", g.paying], [], ["Funnel", "People"]];
    funnel.slice(1).forEach(([t, v]) => rows.push([t, v ?? ""]));
    rows.push([], ["Country", "Members", "Paying", `New in ${period}`, "New in the period before"]);
    g.countries.forEach((c) => rows.push([countryName(c.country), c.members, c.paid, c.new, c.newPrev]));
    rows.push([], ["Cohort", "Size", "Week 1", "Week 2", "Week 3", "Week 4", "Week 5"]);
    g.cohorts.forEach((c) => rows.push([c.month, c.size, ...c.weeks.map((w) => (w < 0 ? "" : w))]));
    rows.push([], ["Plan", "Members"]);
    PLAN.forEach(([key, t]) => rows.push([t, g.plans[key] ?? 0]));
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([rows.map((r) => r.join(",")).join("\n")], { type: "text/csv" }));
    a.download = `e-cinema-growth-${g.days}d${g.country ? "-" + g.country : ""}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  return (
    <section className="exc exg">
      <header className="exc-head">
        <div>
          <h1>Growth and users</h1>
          <p className="exc-sub">Members, sign-ups, conversion and retention in every country. Filter by period and country.</p>
        </div>
        <div className="exc-chips">
          <select aria-label="Period" value={g.days} onChange={(e) => go(Number(e.target.value), g.country)} className="exg-sel">
            <option value={7}>Last 7 days</option><option value={30}>Last 30 days</option><option value={90}>Last 90 days</option>
          </select>
          <select aria-label="Country" value={g.country} onChange={(e) => go(g.days, e.target.value)} className="exg-sel">
            <option value="">All countries</option>
            {g.countryList.map((c) => <option key={c} value={c}>{countryName(c)}</option>)}
          </select>
          <button className="exm-export" onClick={exportCsv}>Export</button>
        </div>
      </header>

      <div className="exc-tiles exg-tiles">
        <div className="exc-tile"><span>Members</span><b>{k(g.members)}</b><small className={grew > 0 ? "up" : ""}>{grew > 0 ? "▲ " : ""}{k(grew)} in {period}</small></div>
        <div className="exc-tile"><span>Daily active</span><b>{k(g.daily)}</b><small>{pct(g.daily, g.members)}% of members</small></div>
        <div className="exc-tile"><span>New this week</span><b>{k(g.newWeek)}</b><small className={wow === null ? "" : wow >= 0 ? "up" : "down"}>{wow === null ? "first week with sign-ups" : `${wow >= 0 ? "▲" : "▼"} ${Math.abs(wow)}% week on week`}</small></div>
        <div className="exc-tile"><span>Free to paid</span><b>{pct(g.paying, g.members)}%</b><small>{k(g.paying)} on a paid plan</small></div>
      </div>

      <div className="exc-row exg-row">
        <div className="exc-card">
          <h2>Members over 12 months</h2>
          <svg viewBox={`-30 -6 ${W + 34} ${H + 26}`} className="exc-svg" role="img" aria-label={`Members now ${k(g.members)}`}>
            {[0, 0.5, 1].map((f) => <g key={f}><line x1="0" x2={W} y1={H - f * (H - 8)} y2={H - f * (H - 8)} stroke="#26262e" /><text x="-6" y={H - f * (H - 8) + 3} textAnchor="end" className="exc-ax">{k(Math.round(max * f))}</text></g>)}
            <polyline points={line} fill="none" stroke="#e3182d" strokeWidth="2.4" strokeLinejoin="round" />
            {g.months.map((m, i) => (i % 2 === 0 || i === 11) && <text key={m.month} x={(i / 11) * W} y={H + 18} textAnchor={i === 11 ? "end" : "middle"} className="exc-ax">{MON[Number(m.month.slice(5)) - 1]}</text>)}
          </svg>
        </div>
        <div className="exc-card">
          <h2>Sign-up funnel</h2>
          <div className="exg-funnel">
            {funnel.map(([t, v], i) => (
              <div key={t} className={v === null ? "off" : ""}>
                <span>{t}</span>
                {v === null ? <em className="soon-tag">Soon</em> : <><i><b style={{ width: `${Math.max(2, (v / fmax) * 100)}%`, background: i === funnel.length - 1 ? "#22c55e" : "#e3182d" }} /></i><strong>{k(v)}</strong></>}
              </div>
            ))}
          </div>
          <p className="exm-note">People who joined in the last {period}.</p>
        </div>
      </div>

      <div className="exg-row3">
        <div className="exc-card">
          <h2>Top countries</h2>
          <div className="exg-table" role="table" aria-label="Top countries">
            <div className="exm-th" role="row"><span role="columnheader">Country</span><span role="columnheader">Members</span><span role="columnheader">Paid</span><span role="columnheader">Growth</span></div>
            {g.countries.map((c) => {
              const gr = c.newPrev ? Math.round(((c.new - c.newPrev) / c.newPrev) * 100) : null;
              return (
                <div key={c.country} className="exm-tr" role="row">
                  <span role="cell">{countryName(c.country)}</span><span role="cell">{k(c.members)}</span><span role="cell">{pct(c.paid, c.members)}%</span>
                  <span role="cell" className={gr === null ? "" : gr >= 0 ? "exg-up" : "exg-down"}>{gr === null ? (c.new ? `+${c.new} new` : "–") : `${gr >= 0 ? "▲" : "▼"} ${Math.abs(gr)}%`}</span>
                </div>
              );
            })}
            {!g.countries.length && <p className="exc-empty">No members with a home country yet.</p>}
          </div>
        </div>
        <div className="exc-card">
          <h2>Retention by sign-up month</h2>
          {g.cohorts.length ? (
            <div className="exg-ret" role="table" aria-label="Retention">
              {g.cohorts.map((c) => (
                <div key={c.month} role="row">
                  <span role="rowheader">{MON[Number(c.month.slice(5)) - 1]}</span>
                  {c.weeks.map((w, i) => {
                    const p = c.size && w >= 0 ? Math.round((w / c.size) * 100) : null;
                    return <i key={i} role="cell" style={p === null ? undefined : { background: `rgba(227,24,45,${0.25 + (p / 100) * 0.75})` }} className={p === null ? "none" : ""}>{p === null ? "" : `${p}%`}</i>;
                  })}
                </div>
              ))}
            </div>
          ) : <p className="exc-empty">No sign-ups in the last four months.</p>}
          <p className="exm-note">Week 1 to week 5 after joining: share of each month&apos;s new members who watched or booked that week.</p>
        </div>
        <div className="exc-card">
          <h2>Plan mix</h2>
          <div className="exg-plans">
            {PLAN.map(([key, t, c]) => {
              const p = pct(g.plans[key] ?? 0, plansTotal);
              return <div key={key}><span>{t}</span><i><b style={{ width: `${p}%`, background: c }} /></i><strong>{Math.round(p)}%</strong></div>;
            })}
          </div>
        </div>
      </div>
    </section>
  );
}
