"use client";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { CommandPage } from "@/lib/exec";
import { pct, type Uptime } from "@/lib/uptime-types";
import { COUNTRIES, MAP_H, MAP_W, countryName, dots, project } from "@/lib/worldmap";

// The command center body (Figma 49:1055): ten tiles, revenue chart, world map, the decisions
// waiting on the CEO and an AI briefing. Every figure is live from the API.
type Range = "live" | "today" | "30" | "year";
const LAND = dots();
const n = (v: number) => v.toLocaleString("en-US");
function usd(cents: number) {
  const v = cents / 100;
  if (Math.abs(v) >= 1e6) return `$${(v / 1e6).toFixed(1).replace(/\.0$/, "")}M`;
  if (Math.abs(v) >= 1e4) return `$${Math.round(v / 1e3)}k`;
  return `$${n(Math.round(v))}`;
}
function count(v: number) {
  if (v >= 1e6) return `${(v / 1e6).toFixed(2).replace(/\.?0+$/, "")}M`;
  if (v >= 1e5) return `${Math.round(v / 1e3)}k`;
  return n(v);
}
function change(now: number, before: number): { text: string; up: boolean | null } {
  if (!before) return { text: now ? "new" : "", up: now ? true : null };
  const p = Math.round(((now - before) / before) * 100);
  return { text: `${Math.abs(p)}%`, up: p === 0 ? null : p > 0 };
}
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const DECIDE: Record<string, { title: (c: number) => string; note: string; href: string; act: string }> = {
  studios: { title: (c) => `${c} studio${c === 1 ? "" : "s"} waiting for approval`, note: "Documents and rights are on the studio desk", href: "/studio/desk", act: "Review" },
  bans: { title: (c) => `${c} ban request${c === 1 ? "" : "s"} from studios`, note: "Leaked copies traced to a viewer", href: "/studio/desk", act: "Decide" },
  licences: { title: (c) => `${c} merch licence application${c === 1 ? "" : "s"}`, note: "Waiting on the licensing desk", href: "/licensing/desk", act: "Review" },
  refunds: { title: (c) => `${c} shop refund${c === 1 ? "" : "s"} in review`, note: "Customers are waiting on an answer", href: "/shop/ops", act: "Review" },
  payouts: { title: (c) => `${c} studio payout${c === 1 ? "" : "s"} failed`, note: "PayPal could not pay these studios; check their payout email", href: "/studio/desk", act: "Check" },
};

export default function ExecCommand({ page: p, hello, when, weekday, up }: { page: CommandPage; hello: string; when: string; weekday: string; up: Uptime | null }) {
  const c = p.command;
  const [range, setRange] = useState<Range>("live");
  const [by, setBy] = useState<"source" | "country">("source");
  const [brief, setBrief] = useState<{ items?: string[]; error?: string } | null>(null);
  useEffect(() => {
    let live = true;
    fetch("/api/executive/briefing").then(async (r) => { const j = await r.json().catch(() => ({})); if (live) setBrief(r.ok ? { items: j.items ?? [] } : { error: j.error || "The AI briefing could not be written just now" }); })
      .catch(() => { if (live) setBrief({ error: "The AI briefing could not be written just now" }); });
    return () => { live = false; };
  }, []);

  const yearGross = c.months.reduce((s, m) => s + m.grossCents, 0);
  const rev = range === "30" ? { label: "Revenue, 30 days", v: c.revenue30, d: change(c.revenue30, c.revenuePrev30), vs: "vs the 30 before" }
    : range === "year" ? { label: "Revenue, 12 months", v: yearGross, d: { text: "", up: null }, vs: "ticket sales" }
    : { label: "Revenue today", v: c.revenueToday, d: change(c.revenueToday, c.revenueWeekAgo), vs: `vs last ${weekday}` };
  const run = change(c.revenue30, c.revenuePrev30);
  const npsD = c.nps - c.npsPrev;
  const tiles: { label: string; value: string; sub: string; up?: boolean | null; soon?: boolean }[] = [
    { label: "Online right now", value: count(p.online), sub: p.online ? `in ${c.liveNow} watch room${c.liveNow === 1 ? "" : "s"}` : "No room is open right now" },
    { label: rev.label, value: usd(rev.v), sub: rev.d.text ? `${rev.d.text} ${rev.vs}` : rev.vs, up: rev.d.up },
    { label: "Annual run rate", value: usd(c.revenue30 * 12), sub: run.text ? `${run.text} on last month` : "from the last 30 days", up: run.up },
    { label: "Paying members", value: count(c.paying), sub: `${n(c.payingWeek)} this week · ${count(c.members)} members`, up: c.payingWeek > 0 ? true : null },
    { label: "Countries live", value: n(c.countries), sub: `${c.countriesNew} new this month`, up: c.countriesNew > 0 ? true : null },
    { label: "Premieres live", value: n(c.liveNow), sub: p.biggestRoom ? `${n(p.biggestRoom)} in the biggest room` : "No one watching yet" },
    up ? { label: "Uptime 30 days", value: pct(up.month), sub: up.up ? `All ${up.monitors} checks up now · ${pct(up.day)} today` : "A check is down right now", up: up.up && up.month >= 99.9 ? true : up.up ? null : false }
      : { label: "Uptime 30 days", value: "", sub: "The uptime monitor did not answer", soon: true },
    { label: "Shop orders today", value: n(c.ordersToday), sub: `₦${n(c.shopTodayNgn)} merch` },
    { label: "Studios", value: n(c.studios), sub: `${c.studiosWeek} verified this week`, up: c.studiosWeek > 0 ? true : null },
    { label: "Net promoter", value: c.reviews ? `${c.nps > 0 ? "+" : ""}${c.nps}` : "–", sub: c.reviews ? `${npsD >= 0 ? "" : "−"}${Math.abs(npsD)} · ${n(c.reviews)} ratings` : "No ratings in 90 days", up: c.reviews ? (npsD === 0 ? null : npsD > 0) : null },
  ];

  // Chart lines over twelve months.
  const W = 420, H = 160;
  const max = Math.max(1, ...c.months.map((m) => m.grossCents));
  const pt = (i: number, v: number) => `${(i / 11) * W},${H - (v / max) * (H - 10)}`;
  const gross = c.months.map((m, i) => pt(i, m.grossCents)).join(" ");
  const net = c.months.map((m, i) => pt(i, m.netCents)).join(" ");

  // Map: live viewers by country when rooms are open, otherwise last 30 days of paid seats.
  const liveMap = p.onlineByCountry.length > 0;
  const spots = useMemo(() => (liveMap ? p.onlineByCountry.map((x) => ({ cc: x.country, v: x.watching })) : c.watching.map((x) => ({ cc: x.country, v: x.seats }))), [liveMap, p.onlineByCountry, c.watching]);
  const total = spots.reduce((s, x) => s + x.v, 0);
  const top = spots.slice(0, 5).map((x) => `${countryName(x.cc, true)} ${Math.round((x.v / Math.max(1, total)) * 100)}%`).join(" · ");
  const peak = Math.max(1, ...spots.map((x) => x.v));

  return (
    <section className="exc">
      <header className="exc-head">
        <div><h1>{hello}</h1><p className="exc-sub">Everything on E-Cinema, live · {when}</p></div>
        <div className="exc-chips" role="group" aria-label="Period">
          {([["live", "Live"], ["today", "Today"], ["30", "30 days"], ["year", "Year"]] as [Range, string][]).map(([k, t]) => (
            <button key={k} className={range === k ? "on" : ""} aria-pressed={range === k} onClick={() => setRange(k)}>{t}</button>
          ))}
          {c.role === "ceo" && <Link className="exc-ask exc-global" href="/executive/overview">Global overview</Link>}
          <span className="exc-ask" aria-disabled="true">Ask E-Cinema AI<em className="soon-tag">Soon</em></span>
        </div>
      </header>

      <div className="exc-tiles">
        {tiles.map((t) => (
          <div key={t.label} className={`exc-tile${t.soon ? " soon" : ""}`}>
            <span>{t.label}{t.soon && <em className="soon-tag">Soon</em>}</span>
            {!t.soon && <b>{t.value}</b>}
            <small className={t.up === true ? "up" : t.up === false ? "down" : ""}>{t.up === true ? "▲ " : t.up === false ? "▼ " : ""}{t.sub}</small>
          </div>
        ))}
      </div>

      <div className="exc-row">
        <div className="exc-card exc-chart">
          <div className="exc-card-h">
            <h2>{by === "source" ? "Revenue, last 12 months (USD)" : "Paid seats by country, 30 days"}</h2>
            <div className="exc-seg" role="group" aria-label="Chart">
              <button className={by === "source" ? "on" : ""} aria-pressed={by === "source"} onClick={() => setBy("source")}>By source</button>
              <button className={by === "country" ? "on" : ""} aria-pressed={by === "country"} onClick={() => setBy("country")}>By country</button>
            </div>
          </div>
          {by === "source" ? (
            <>
              <svg viewBox={`0 -4 ${W} ${H + 24}`} className="exc-svg" role="img" aria-label={`Gross ticket revenue ${usd(yearGross)} over twelve months`}>
                {[0.25, 0.5, 0.75].map((f) => <line key={f} x1="0" x2={W} y1={H * f} y2={H * f} stroke="#26262e" strokeWidth="1" />)}
                <polygon points={`0,${H} ${gross} ${W},${H}`} fill="url(#excg)" opacity=".5" />
                <defs><linearGradient id="excg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#8b7cf6" stopOpacity=".55" /><stop offset="1" stopColor="#8b7cf6" stopOpacity="0" /></linearGradient></defs>
                <polyline points={gross} fill="none" stroke="#8b7cf6" strokeWidth="2.2" strokeLinejoin="round" />
                <polyline points={net} fill="none" stroke="#e3182d" strokeWidth="2.2" strokeLinejoin="round" />
                {c.months.map((m, i) => (i % 2 === 1 || i === 11) && <text key={m.month} x={(i / 11) * W} y={H + 18} textAnchor={i === 11 ? "end" : "middle"} className="exc-ax">{MON[Number(m.month.slice(5)) - 1]}</text>)}
              </svg>
              <p className="exc-legend"><i style={{ background: "#8b7cf6" }} />Gross {usd(yearGross)}<i style={{ background: "#e3182d" }} />E-Cinema net (30% after studios)</p>
            </>
          ) : c.watching.length ? (
            <ul className="exc-bars">
              {c.watching.slice(0, 8).map((w) => (
                <li key={w.country}><span>{countryName(w.country)}</span><i style={{ width: `${(w.seats / c.watching[0].seats) * 100}%` }} /><b>{n(w.seats)}</b></li>
              ))}
            </ul>
          ) : <p className="exc-empty">No paid seats in the last 30 days.</p>}
        </div>

        <div className="exc-card exc-map">
          <h2>Where people are watching</h2>
          <svg viewBox={`0 0 ${MAP_W} ${MAP_H}`} className="exc-world" role="img" aria-label={top || "No viewers to show yet"}>
            {LAND.map((d, i) => <circle key={i} cx={d.x} cy={d.y} r="2.4" fill="#34343f" />)}
            {spots.map((s) => {
              const k = COUNTRIES[s.cc];
              if (!k) return null;
              const { x, y } = project(k.lat, k.lon);
              const r = 8 + 18 * Math.sqrt(s.v / peak);
              return <g key={s.cc}><circle cx={x} cy={y} r={r * 1.8} fill="#e3182d" opacity=".18" /><circle cx={x} cy={y} r={r * 0.6} fill={s.cc === spots[0].cc ? "#e3182d" : "#8b7cf6"} /></g>;
            })}
          </svg>
          <p className="exc-legend">{top ? `${liveMap ? "Watching now" : "Paid seats, 30 days"}: ${top}` : "No viewers to show yet."}</p>
        </div>
      </div>

      <div className="exc-row">
        <div className="exc-card">
          <h2>Needs your decision</h2>
          {c.decisions.length ? c.decisions.map((d) => {
            const k = DECIDE[d.kind];
            if (!k) return null;
            return (
              <div key={d.kind} className="exc-dec">
                <div><b>{k.title(d.count)}</b><small>{k.note}</small></div>
                <Link href={k.href}>{k.act}</Link>
              </div>
            );
          }) : <p className="exc-empty">Nothing is waiting on you right now.</p>}
        </div>
        <div className="exc-card">
          <h2>E-Cinema AI briefing</h2>
          {!brief ? <p className="exc-empty">Reading today&apos;s numbers…</p>
            : brief.error ? <p className="exc-empty">{brief.error}</p>
            : brief.items!.map((t, i) => (
              <div key={i} className="exc-brief"><svg viewBox="0 0 24 24" width="14" height="14" fill="#8b7cf6" aria-hidden><path d="M12 2l1.8 6.2L20 10l-6.2 1.8L12 18l-1.8-6.2L4 10l6.2-1.8z" /></svg><p>{t}</p></div>
            ))}
        </div>
      </div>
    </section>
  );
}
