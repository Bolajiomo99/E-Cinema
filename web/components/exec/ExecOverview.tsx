"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { COUNTRIES, MAP_H, MAP_W, countryName, dots, project } from "@/lib/worldmap";
import { DECIDE } from "@/components/exec/ExecCommand";
import type { InfraBackup } from "@/lib/exec";

// CEO global overview (Figma 117:684). Live refreshes every 5 seconds; every number comes from
// the API. Plans and business deals are not recorded as payments yet, so they show as Soon.
export type OverviewView = {
  revenueToday: number; revenueWeekAgo: number; revenue30: number; revenuePrev30: number;
  watching: number; peakToday: number | null; members: number; membersToday: number; countries: number; countriesNew: number;
  studios: number; studiosWaiting: number | null; partners: number | null; royaltyNgn: number | null;
  openRoles: number | null; openNg: number; ngTarget: number; blockedToday: number | null; breaches: number; openCritical: number | null;
  weeks: { week: string; streams: Record<string, number> }[]; month: Record<string, number>;
  spots: { cc: string; v: number }[]; live: boolean;
  p50Ms: number | null; p99Ms: number | null; dbConns: number | null; dbMaxConns: number | null;
  backups: InfraBackup[]; decisions: { kind: string; count: number }[];
};

const LAND = dots();
const STREAMS = [
  { k: "tickets", label: "Tickets and pre-orders", color: "#e3182d" },
  { k: "plans", label: "Plans", color: "#8b7cf6", soon: true },
  { k: "shop", label: "Shop", color: "#d4a032" },
  { k: "licensing", label: "Licensing fees and royalties", color: "#2bb3a3" },
  { k: "business", label: "Business and brands", color: "#3b82f6", soon: true },
];
const n = (v: number) => v.toLocaleString("en-US");
function big(v: number) {
  if (Math.abs(v) >= 1e9) return `${(v / 1e9).toFixed(2).replace(/\.?0+$/, "")}B`;
  if (Math.abs(v) >= 1e6) return `${(v / 1e6).toFixed(1).replace(/\.0$/, "")}M`;
  if (Math.abs(v) >= 1e4) return `${Math.round(v / 1e3)}K`;
  return n(Math.round(v));
}
const naira = (v: number) => `₦${big(v)}`;
function pct(now: number, before: number): { text: string; up: boolean | null } {
  if (!before) return { text: now ? "new" : "", up: now ? true : null };
  const p = Math.round(((now - before) / before) * 100);
  return { text: `${p >= 0 ? "+" : "−"}${Math.abs(p)}%`, up: p === 0 ? null : p > 0 };
}
function ago(iso: string) {
  const m = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000));
  return m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} days ago`;
}

function Gauge({ value, label, color, soon }: { value: number; label: string; color: string; soon?: boolean }) {
  const r = 38, len = Math.PI * r, v = Math.max(0, Math.min(1, value));
  return (
    <div className={`exov-gauge${soon ? " soon" : ""}`}>
      <svg viewBox="0 0 100 56" aria-hidden="true">
        <path d="M12 50a38 38 0 0 1 76 0" fill="none" stroke="#26262e" strokeWidth="9" strokeLinecap="round" />
        {!soon && <path d="M12 50a38 38 0 0 1 76 0" fill="none" stroke={color} strokeWidth="9" strokeLinecap="round" strokeDasharray={`${len * v} ${len}`} />}
      </svg>
      <span>{label}</span>
    </div>
  );
}

export default function ExecOverview({ v }: { v: OverviewView }) {
  const router = useRouter();
  const [range, setRange] = useState<"live" | "today" | "30">("live");
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const t0 = setTimeout(() => setNow(Date.now()), 0);
    if (range !== "live") return () => clearTimeout(t0);
    const t = setInterval(() => { router.refresh(); setNow(Date.now()); }, 5000);
    return () => { clearTimeout(t0); clearInterval(t); };
  }, [range, router]);

  const rev = range === "30" ? { label: "Revenue, 30 days", v: v.revenue30, d: pct(v.revenue30, v.revenuePrev30), vs: "vs the 30 days before" }
    : { label: "Revenue today", v: v.revenueToday, d: pct(v.revenueToday, v.revenueWeekAgo), vs: "vs the same day last week" };
  const ngNow = v.openRoles ? Math.round((v.openNg / v.openRoles) * 100) : 0;
  const tiles: { label: string; value: string; sub: string; up?: boolean | null }[] = [
    { label: rev.label, value: naira(rev.v), sub: rev.d.text ? `${rev.d.text} ${rev.vs}` : "No sales yet", up: rev.d.up },
    { label: "Watching now", value: big(v.watching), sub: v.peakToday != null ? `peak ${big(v.peakToday)} today` : "No room open", up: v.watching > 0 ? true : null },
    { label: "Members", value: big(v.members), sub: `+${n(v.membersToday)} today`, up: v.membersToday > 0 ? true : null },
    { label: "Countries live", value: n(v.countries), sub: `${v.countriesNew} new this month` },
    { label: "Studios", value: n(v.studios), sub: v.studiosWaiting != null ? `${v.studiosWaiting} waiting approval` : "" },
    { label: "Licensed merch partners", value: v.partners != null ? n(v.partners) : "–", sub: v.royaltyNgn != null ? `${naira(v.royaltyNgn)} royalty this month` : "", up: v.royaltyNgn ? true : null },
    { label: "Open roles", value: v.openRoles != null ? n(v.openRoles) : "–", sub: v.openRoles ? `Nigeria ${ngNow}% · ${ngNow >= v.ngTarget ? "met" : `below ${v.ngTarget}%`}` : "No open roles" },
    { label: "Attacks blocked today", value: v.blockedToday != null ? big(v.blockedToday) : "–", sub: `${n(v.breaches)} breach${v.breaches === 1 ? "" : "es"}`, up: v.breaches === 0 ? true : false },
  ];

  const maxWeek = Math.max(1, ...v.weeks.map((w) => Object.values(w.streams).reduce((a, b) => a + b, 0)));
  const monthTotal = Object.values(v.month).reduce((a, b) => a + b, 0);
  const total = v.spots.reduce((a, s) => a + s.v, 0);
  const peak = Math.max(1, ...v.spots.map((s) => s.v));
  const latest = v.backups[0];
  const healthy = v.backups.filter((b) => b.restored).length;

  // Donut arcs for this month's mix: each arc starts where the shares before it end.
  const C = 2 * Math.PI * 44;
  const shown = STREAMS.filter((s) => (v.month[s.k] ?? 0) > 0);
  const arcs = shown.map((s, i) => {
    const before = shown.slice(0, i).reduce((a, x) => a + (v.month[x.k] ?? 0), 0) / monthTotal;
    const share = (v.month[s.k] ?? 0) / monthTotal;
    return { ...s, dash: `${share * C} ${C}`, off: -before * C };
  });

  return (
    <section className="exc exov">
      <header className="exc-head">
        <div>
          <h1>Everything, right now</h1>
          <p className="exc-sub">Live across {n(v.countries)} countr{v.countries === 1 ? "y" : "ies"} · {range === "live" ? "updated every 5 seconds" : "paused"} · CEO only</p>
        </div>
        <div className="exc-chips">
          {(["live", "today", "30"] as const).map((r) => <button key={r} type="button" className={range === r ? "on" : ""} aria-pressed={range === r} onClick={() => setRange(r)}>{r === "live" ? "Live" : r === "today" ? "Today" : "30 days"}</button>)}
          <button type="button" className="exov-pdf" onClick={() => window.print()}>Board pack PDF</button>
        </div>
      </header>

      <div className="exc-tiles exov-tiles">
        {tiles.map((t) => (
          <div key={t.label} className="exc-tile"><span>{t.label}</span><b>{t.value}</b><small className={t.up === true ? "up" : t.up === false ? "down" : ""}>{t.sub}</small></div>
        ))}
      </div>

      <div className="exov-row">
        <div className="exc-card">
          <h2>Revenue by stream · last 12 weeks</h2>
          {v.weeks.length ? (
            <div className="exov-bars" role="img" aria-label={`Weekly revenue, highest ${naira(maxWeek)}`}>
              {v.weeks.map((w) => (
                <div key={w.week} className="exov-bar" title={`Week of ${w.week}: ${naira(Object.values(w.streams).reduce((a, b) => a + b, 0))}`}>
                  {STREAMS.slice().reverse().map((s) => (w.streams[s.k] ? <i key={s.k} style={{ height: `${(w.streams[s.k] / maxWeek) * 100}%`, background: s.color }} /> : null))}
                </div>
              ))}
            </div>
          ) : <p className="exc-empty">No sales in the last 12 weeks.</p>}
          <ul className="exov-key">
            {STREAMS.map((s) => <li key={s.k}><i style={{ background: s.color }} />{s.label}{s.soon && <small className="exsec-soon">Soon</small>}</li>)}
          </ul>
        </div>
        <div className="exc-card">
          <h2>Who is watching{v.live ? ", live" : ", last 30 days"}</h2>
          <svg viewBox={`0 0 ${MAP_W} ${MAP_H}`} className="exc-world" role="img" aria-label={total ? "Viewers by country" : "No viewers to show yet"}>
            {LAND.map((d, i) => <circle key={i} cx={d.x} cy={d.y} r="2.4" fill="#34343f" />)}
            {v.spots.map((s) => {
              const k = COUNTRIES[s.cc];
              if (!k) return null;
              const { x, y } = project(k.lat, k.lon);
              const r = 8 + 18 * Math.sqrt(s.v / peak);
              return <g key={s.cc}><circle cx={x} cy={y} r={r * 1.6} fill="#e3182d" opacity=".18" /><circle cx={x} cy={y} r={r * 0.45} fill="#e3182d" /></g>;
            })}
          </svg>
          <p className="exc-legend">{total ? v.spots.slice(0, 5).map((s) => `${countryName(s.cc, true)} ${big(s.v)}`).join(" · ") : "No viewers to show yet."}</p>
        </div>
      </div>

      <div className="exov-row3">
        <div className="exc-card">
          <h2>Money mix this month</h2>
          {monthTotal ? (
            <div className="exov-mix">
              <svg viewBox="0 0 120 120" aria-hidden="true"><circle cx="60" cy="60" r="44" fill="none" stroke="#26262e" strokeWidth="20" />
                {arcs.map((a) => <circle key={a.k} cx="60" cy="60" r="44" fill="none" stroke={a.color} strokeWidth="20" strokeDasharray={a.dash} strokeDashoffset={a.off} transform="rotate(-90 60 60)" />)}
              </svg>
              <ul className="exov-key">{STREAMS.map((s) => <li key={s.k}><i style={{ background: s.color }} />{s.label.split(" ")[0]} {s.soon ? <small className="exsec-soon">Soon</small> : `${Math.round(((v.month[s.k] ?? 0) / monthTotal) * 100)}%`}</li>)}</ul>
            </div>
          ) : <p className="exc-empty">No money in yet this month.</p>}
        </div>
        <div className="exc-card">
          <h2>Health</h2>
          <div className="exov-gauges">
            <Gauge soon value={0} label="Uptime · needs the monitor key" color="#2bb3a3" />
            <Gauge value={v.p50Ms != null ? 1 - Math.min(1, v.p50Ms / 1000) : 0} label={v.p50Ms != null ? `API reply ${Math.round(v.p50Ms)} ms (p50)` : "API reply –"} color="#2bb3a3" />
            <Gauge value={v.dbConns != null && v.dbMaxConns ? v.dbConns / v.dbMaxConns : 0} label={v.dbConns != null ? `Database ${v.dbConns}/${v.dbMaxConns} links` : "Database –"} color={v.dbConns != null && v.dbMaxConns && v.dbConns / v.dbMaxConns > 0.75 ? "#f2b84b" : "#2bb3a3"} />
          </div>
          <div className="exov-hl"><div><b>Backups</b><small>{latest ? `${healthy} of ${v.backups.length} copies test-restored · last ${now ? ago(latest.finishedAt) : "…"}` : "No backup has run yet"}</small></div><span className={latest ? "ok" : "bad"}>{latest ? "OK" : "NONE"}</span></div>
          <div className="exov-hl"><div><b>Security</b><small>{v.openCritical ? `${v.openCritical} open critical alert${v.openCritical === 1 ? "" : "s"}` : "No open critical alerts"}</small></div><span className={v.openCritical ? "bad" : "ok"}>{v.openCritical ? "ACT" : "OK"}</span></div>
        </div>
        <div className="exc-card">
          <h2>Needs you</h2>
          {v.decisions.length ? v.decisions.map((d) => {
            const k = DECIDE[d.kind];
            if (!k) return null;
            return <div key={d.kind} className="exov-need"><div><b>{k.title(d.count)}</b><small>{k.note}</small></div><Link href={k.href}>Open</Link></div>;
          }) : <p className="exc-empty">Nothing is waiting on you right now.</p>}
        </div>
      </div>
    </section>
  );
}
