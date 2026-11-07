"use client";
import Link from "next/link";
import { useState } from "react";
import { COUNTRIES, MAP_H, MAP_W, countryName, dots, project } from "@/lib/worldmap";
import { dubName } from "@/lib/dub-types";
import { MONTHS, money } from "@/lib/studio-types";

// Figma "Studio / Analytics": Audience (37:1652) and Reach (37:2861). Every number is the studio's
// own: watch time, reviews, rewatch parties, tickets and refunds. Parts that need player reports
// we do not collect yet say "Soon" instead of showing made-up numbers. Retention, hours and
// devices come from the reports the player sends each minute.

type Count = { key: string; seats: number };
export type AnalyticsData = {
  days: number; from: string; to: string; shareBps: number;
  viewers: number; viewersPrev: number; watchHours: number; watchHoursPrev: number;
  completion: number; completionPrev: number; rewatch: number; rewatchPrev: number;
  nps: number | null; npsPrev: number | null; reviews: number;
  ages: Count[]; genders: Count[]; withFriends: number; plans: Count[];
  countries: { country: string; viewers: number; grossCents: number }[];
  audio: Count[];
  cohorts: { month: string; size: number; back: number[] }[];
  money: { grossCents: number; platformCents: number; refundCents: number; shareCents: number; perViewerCents: number; buyers: number };
  funnel: { orders: number; seats: number; gifts: number };
  // From player reports, for screenings in the period: share still watching at 0%, 5% … 100%.
  audience?: { viewers: number; retention: number[]; hours: number[][]; devices: Record<string, number> } | null;
};

const DEVICES: [string, string][] = [["android", "Android"], ["ios", "iPhone"], ["web", "Web"], ["tv", "TV"], ["tablet", "Tablet"], ["vr", "VR"]];
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function Retention({ a }: { a: NonNullable<AnalyticsData["audience"]> }) {
  const W = 520, H = 160;
  const pts = a.retention.map((v, i) => ({ x: (i / 20) * W, y: H - v * (H - 8) - 4 }));
  const line = pts.map((p, i) => `${i ? "L" : "M"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  let drop = 1;
  for (let i = 2; i < a.retention.length; i++) if (a.retention[i - 1] - a.retention[i] > a.retention[drop - 1] - a.retention[drop]) drop = i;
  const fell = a.retention[drop - 1] - a.retention[drop];
  return (
    <>
      <svg className="stan-curve" viewBox={`0 0 ${W} ${H + 18}`} role="img" aria-label={`Retention: ${pct(a.retention[10])} still watching at half-way, ${pct(a.retention[20])} at the end`}>
        {[0.25, 0.5, 0.75].map((g) => <line key={g} x1={0} x2={W} y1={H - g * (H - 8) - 4} y2={H - g * (H - 8) - 4} className="grid" />)}
        <path d={`${line} L${W},${H} L0,${H} Z`} className="area" />
        <path d={line} className="line" />
        {["0%", "25%", "50%", "75%", "100%"].map((t, i) => <text key={t} x={(i / 4) * W} y={H + 14} textAnchor={i === 0 ? "start" : i === 4 ? "end" : "middle"}>{t}</text>)}
      </svg>
      <p className="stan-note">
        Of {n(a.viewers)} {a.viewers === 1 ? "viewer" : "viewers"} who pressed play, {pct(a.retention[10])} were still watching half-way and {pct(a.retention[20])} reached the end.
        {fell >= 0.05 ? ` The most people left between ${(drop - 1) * 5}% and ${drop * 5}% of the runtime.` : ""}
      </p>
    </>
  );
}

function Hours({ hours }: { hours: number[][] }) {
  const max = Math.max(1, ...hours.flat());
  return (
    <div className="stan-hours" role="table" aria-label="Viewers by local day and hour">
      {hours.map((row, d) => (
        <div key={d} role="row" className="stan-hr">
          <span role="rowheader">{DAYS[d]}</span>
          {row.map((v, h) => <i key={h} role="cell" title={`${DAYS[d]} ${String(h).padStart(2, "0")}:00 · ${n(v)}`} style={{ opacity: v ? 0.15 + 0.85 * (v / max) : 1 }} className={v ? "on" : ""} />)}
        </div>
      ))}
      <div className="stan-hr ax" aria-hidden><span />{[0, 6, 12, 18].map((h) => <small key={h} style={{ gridColumn: `${h + 2} / span 6` }}>{String(h).padStart(2, "0")}:00</small>)}</div>
    </div>
  );
}

const LAND = dots();
const n = (v: number) => v.toLocaleString("en-US");
const short = (v: number) => (v >= 10000 ? new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(v) : n(Math.round(v)));
const pct = (v: number) => `${Math.round(v * 100)}%`;
const AGE_ORDER = ["under 18", "18-24", "25-34", "35-44", "45-54", "55+", "unknown"];
const AGE_LABEL: Record<string, string> = { "under 18": "Under 18", unknown: "Not given" };
const AGE_COLORS = ["#ff8c28", "#e3182d", "#f5b73b", "#8b7cf6", "#26b5a0", "#3a3a44", "#55555f"];
const GENDER: Record<string, string> = { female: "Women", male: "men", "non-binary": "non-binary", unknown: "undisclosed" };
const PLAN_ORDER = ["free", "pro", "vip", "student", "enterprise"];
const PLAN_LABEL: Record<string, string> = { free: "Free", pro: "Pro", vip: "VIP", student: "Student", enterprise: "Ent." };
const PLAN_COLORS: Record<string, string> = { free: "#c81d2e", pro: "#e3182d", vip: "#9b1826", student: "#7c1520", enterprise: "#6a121c" };
const TABS = [
  { key: "audience", label: "Audience" },
  { key: "retention", label: "Retention", on: "audience", anchor: "retention" },
  { key: "reach", label: "Reach" },
  { key: "languages", label: "Languages", on: "reach", anchor: "languages" },
  { key: "money", label: "Money", on: "reach", anchor: "money" },
  { key: "funnels", label: "Funnels", on: "reach", anchor: "funnel" },
  { key: "cohorts", label: "Cohorts", on: "reach", anchor: "cohorts" },
];

// Change against the previous period of the same length.
function delta(now: number, before: number, points = false) {
  if (points) {
    const d = Math.round((now - before) * 100);
    return { text: `${d >= 0 ? "▲" : "▼"} ${Math.abs(d)} pts`, up: d >= 0 };
  }
  if (!before) return { text: now ? "new this period" : "nothing yet", up: true };
  const p = Math.round(((now - before) / before) * 100);
  return { text: `${p >= 0 ? "▲" : "▼"} ${Math.abs(p)}%`, up: p >= 0 };
}

function Tile({ label, value, sub, up, soon }: { label: string; value: string; sub: string; up?: boolean; soon?: boolean }) {
  return (
    <div className={`stcr-tile${soon ? " soon" : ""}`}>
      <small>{label}</small>
      <b>{value}</b>
      <span className={up === undefined ? "" : up ? "g" : "r"}>{sub}</span>
    </div>
  );
}

function Donut({ parts }: { parts: { label: string; value: number; color: string }[] }) {
  const total = parts.reduce((a, p) => a + p.value, 0) || 1;
  const R = 52, C = 2 * Math.PI * R;
  const lens = parts.map((p) => (p.value / total) * C);
  const starts = lens.map((_, i) => lens.slice(0, i).reduce((a, b) => a + b, 0));
  return (
    <svg viewBox="0 0 140 140" className="stan-donut" role="img" aria-label={parts.map((p) => `${p.label} ${Math.round((p.value / total) * 100)}%`).join(", ")}>
      <circle cx="70" cy="70" r={R} fill="none" stroke="#24242b" strokeWidth="22" />
      {parts.map((p, i) => (
        <circle key={p.label} cx="70" cy="70" r={R} fill="none" stroke={p.color} strokeWidth="22" strokeDasharray={`${Math.max(0, lens[i] - 1.5)} ${C}`} strokeDashoffset={-starts[i]} transform="rotate(-90 70 70)" />
      ))}
    </svg>
  );
}

function Bars({ items, color }: { items: { label: string; value: number; color?: string }[]; color?: string }) {
  const max = Math.max(1, ...items.map((i) => i.value));
  return (
    <div className="stan-bars">
      {items.map((i) => (
        <div key={i.label} className="stan-bar" title={`${i.label}: ${n(i.value)}`}>
          <span className="v">{short(i.value)}</span>
          <i style={{ height: `${Math.max(4, (i.value / max) * 100)}%`, background: i.color ?? color }} />
          <small>{i.label}</small>
        </div>
      ))}
    </div>
  );
}

function csv(d: AnalyticsData) {
  const rows: (string | number)[][] = [["Section", "Item", "Value", "Previous period"]];
  rows.push(["Period", "From", d.from.slice(0, 10), ""], ["Period", "To (exclusive)", d.to.slice(0, 10), ""]);
  rows.push(["Audience", "Unique viewers", d.viewers, d.viewersPrev], ["Audience", "Watch hours", d.watchHours.toFixed(1), d.watchHoursPrev.toFixed(1)]);
  rows.push(["Audience", "Avg completion", pct(d.completion), pct(d.completionPrev)], ["Audience", "Rewatch requests", d.rewatch, d.rewatchPrev]);
  rows.push(["Audience", "Net promoter", d.nps ?? "", d.npsPrev ?? ""], ["Audience", "Watched with friends", pct(d.withFriends), ""]);
  d.ages.forEach((a) => rows.push(["Age", AGE_LABEL[a.key] ?? a.key, a.seats, ""]));
  d.genders.forEach((g) => rows.push(["Gender", g.key, g.seats, ""]));
  d.plans.forEach((p) => rows.push(["Plan", PLAN_LABEL[p.key] ?? p.key, p.seats, ""]));
  d.countries.forEach((c) => rows.push(["Country", countryName(c.country), c.viewers, (c.grossCents / 100).toFixed(2)]));
  d.audio.forEach((a) => rows.push(["Audio language", a.key ? dubName(a.key) : "Original", a.seats, ""]));
  d.cohorts.forEach((c) => rows.push(["Cohort", c.month, c.size, c.back.map(pct).join(" / ")]));
  rows.push(["Money (USD)", "Gross", (d.money.grossCents / 100).toFixed(2), ""], ["Money (USD)", "Refunds", (d.money.refundCents / 100).toFixed(2), ""]);
  rows.push(["Money (USD)", "Platform", (d.money.platformCents / 100).toFixed(2), ""], ["Money (USD)", "Your share", (d.money.shareCents / 100).toFixed(2), ""]);
  rows.push(["Tickets", "Orders", d.funnel.orders, ""], ["Tickets", "Seats", d.funnel.seats, ""], ["Tickets", "Gifted seats", d.funnel.gifts, ""]);
  const esc = (v: string | number) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
  return rows.map((r) => r.map(esc).join(",")).join("\n");
}

export default function StudioAnalytics({ data: d, tab }: { data: AnalyticsData; tab: "audience" | "reach" }) {
  const [compare, setCompare] = useState(true);
  const [layer, setLayer] = useState<"viewers" | "revenue">("viewers");
  const share = Math.round(d.shareBps / 100);
  const q = (t: string, days = d.days) => `/studio/analytics?tab=${t}&days=${days}`;

  function exportCsv() {
    const url = URL.createObjectURL(new Blob([csv(d)], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `e-cinema-analytics-${d.to.slice(0, 10)}-${d.days}d.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  const vd = delta(d.viewers, d.viewersPrev), hd = delta(d.watchHours, d.watchHoursPrev), cd = d.viewersPrev ? delta(d.completion, d.completionPrev, true) : delta(d.completion, 0), rd = delta(d.rewatch, d.rewatchPrev);
  const npsD = d.nps !== null && d.npsPrev !== null ? { text: `${d.nps - d.npsPrev >= 0 ? "▲" : "▼"} ${Math.abs(d.nps - d.npsPrev)}`, up: d.nps >= d.npsPrev } : null;

  const ages = AGE_ORDER.flatMap((k, i) => {
    const c = d.ages.find((a) => a.key === k);
    return c ? [{ label: AGE_LABEL[k] ?? k, value: c.seats, color: AGE_COLORS[i] }] : [];
  });
  const ageTotal = ages.reduce((a, p) => a + p.value, 0);
  const gTotal = d.genders.reduce((a, g) => a + g.seats, 0);
  const genders = d.genders.map((g) => `${GENDER[g.key] ?? g.key} ${Math.round((g.seats / gTotal) * 100)}%`).join(" · ");
  const plans = PLAN_ORDER.map((k) => ({ label: PLAN_LABEL[k], value: d.plans.find((p) => p.key === k)?.seats ?? 0, color: PLAN_COLORS[k] }));

  const countries = d.countries.filter((c) => COUNTRIES[c.country]);
  const metric = (c: { viewers: number; grossCents: number }) => (layer === "viewers" ? c.viewers : c.grossCents);
  const maxC = Math.max(1, ...countries.map(metric));
  const audio = d.audio.map((a) => ({ label: a.key ? dubName(a.key) : "Original", value: a.seats }));
  const dubbed = d.audio.filter((a) => a.key).reduce((s, a) => s + a.seats, 0);
  const original = d.audio.find((a) => !a.key)?.seats ?? 0;
  // Only months whose following month is over, so a month still running never reads as "0% came back".
  const thisMonth = new Date(Date.parse(d.to) - 86400_000).toISOString().slice(0, 7);
  const after = (m: string) => { const y = Number(m.slice(0, 4)), mo = Number(m.slice(5, 7)); return mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, "0")}`; };
  const cohortNote = [...d.cohorts].reverse().find((c) => c.back.length > 0 && c.size > 0 && after(c.month) < thisMonth);
  const m = d.money;

  return (
    <div className="pt-body stcr stan">
      <header className="bp-head">
        <div>
          <h1>Analytics</h1>
          <p>All films · last {d.days} days</p>
        </div>
        <div className="pt-btns">
          <label className="stan-range">
            <span className="sr-only">Period</span>
            <select value={d.days} onChange={(e) => { window.location.href = q(tab, Number(e.target.value)); }}>
              {[7, 30, 90, 365].map((v) => <option key={v} value={v}>Last {v} days</option>)}
            </select>
          </label>
          {tab === "audience" && <button type="button" className={`stan-pill${compare ? "" : " off"}`} aria-pressed={compare} onClick={() => setCompare(!compare)}>Compare: previous {d.days}</button>}
          <button type="button" className="vf-btn ghost" onClick={exportCsv}>Export</button>
          <Link className="vf-btn red" href={`/studio/ai?q=${encodeURIComponent(`What stands out in my audience over the last ${d.days} days?`)}`}>Ask Studio AI</Link>
        </div>
      </header>

      <nav className="bp-chips stan-tabs" aria-label="Analytics views">
        {TABS.map((t) => <Link key={t.key} className={`stpr-film${tab === t.key ? " on" : ""}`} href={`${q(t.on ?? t.key)}${t.anchor ? `#${t.anchor}` : ""}`} aria-current={tab === t.key ? "page" : undefined}>{t.label}</Link>)}
      </nav>

      {tab === "audience" ? (
        <>
          <div className="stcr-tiles">
            <Tile label="Unique viewers" value={n(d.viewers)} sub={compare ? vd.text : `${n(d.viewersPrev)} before`} up={compare ? vd.up : undefined} />
            <Tile label="Watch hours" value={short(d.watchHours)} sub={compare ? hd.text : `${short(d.watchHoursPrev)} before`} up={compare ? hd.up : undefined} />
            <Tile label="Avg completion" value={d.viewers ? pct(d.completion) : "–"} sub={d.viewers ? (compare ? cd.text : "of each film watched") : "No watch time yet"} up={compare && d.viewers ? cd.up : undefined} />
            <Tile label="Rewatch requests" value={n(d.rewatch)} sub={compare ? rd.text : "rewatch parties planned"} up={compare ? rd.up : undefined} />
            <Tile label="Net promoter" value={d.nps === null ? "–" : `${d.nps > 0 ? "+" : ""}${d.nps}`} sub={d.nps === null ? "No reviews yet" : compare && npsD ? npsD.text : `from ${n(d.reviews)} ${d.reviews === 1 ? "review" : "reviews"}`} up={d.nps !== null && compare && npsD ? npsD.up : undefined} />
          </div>

          <div className="stcr-row">
            <section className="bp-panel stan-ret" id="retention" aria-label="Audience retention">
              <h2>Audience retention</h2>
              {d.audience?.viewers ? <Retention a={d.audience} /> : <p className="pt-hint">The curve of who keeps watching appears once viewers of this period&apos;s screenings press play.</p>}
            </section>
            <section className="bp-panel stan-who" aria-label="Who watched">
              <h2>Who watched</h2>
              {ageTotal ? (
                <>
                  <div className="stan-donutrow">
                    <Donut parts={ages} />
                    <ul className="stan-key">
                      {ages.map((a) => <li key={a.label}><i style={{ background: a.color }} />{a.label} · {Math.round((a.value / ageTotal) * 100)}%</li>)}
                    </ul>
                  </div>
                  <p className="stan-note">{genders}</p>
                  <p className="stan-note">Watched with friends {pct(d.withFriends)} · alone {pct(1 - d.withFriends)}</p>
                </>
              ) : <p className="pt-hint">Ages and groups appear once people watch your films in this period.</p>}
            </section>
          </div>

          <div className="stan-three">
            <section className="bp-panel" aria-label="When people watch">
              <h2>When people watch (local time)</h2>
              {d.audience?.viewers ? <Hours hours={d.audience.hours} /> : <p className="pt-hint">The hour grid fills in as viewers press play.</p>}
            </section>
            <section className="bp-panel" aria-label="Devices">
              <h2>Devices</h2>
              {d.audience?.viewers ? <Bars items={DEVICES.map(([k, label]) => ({ label, value: d.audience?.devices[k] ?? 0 }))} color="#26b5a0" /> : <p className="pt-hint">Devices appear as viewers press play.</p>}
            </section>
            <section className="bp-panel" aria-label="Plans">
              <h2>Plans</h2>
              {d.viewers ? <Bars items={plans} /> : <p className="pt-hint">Plans appear once people watch in this period.</p>}
            </section>
          </div>
        </>
      ) : (
        <>
          <div className="stcr-row">
            <section className="bp-panel stcr-map" aria-label="Where your audience is">
              <div className="stcr-ph">
                <h2>Where your audience is</h2>
                <div className="bp-chips">
                  <button type="button" className={layer === "viewers" ? "on" : ""} aria-pressed={layer === "viewers"} onClick={() => setLayer("viewers")}>Viewers</button>
                  <button type="button" className={layer === "revenue" ? "on" : ""} aria-pressed={layer === "revenue"} onClick={() => setLayer("revenue")}>Revenue</button>
                  <button type="button" disabled title="Coming soon">Growth <em className="soon-tag">Soon</em></button>
                </div>
              </div>
              <div className="stcr-world">
                <svg viewBox={`0 0 ${MAP_W} ${MAP_H}`} preserveAspectRatio="xMidYMid meet" role="img" aria-label={`${countries.length} countries`}>
                  {LAND.map((p, i) => <circle key={i} cx={p.x} cy={p.y} r={3.4} className="stcr-dot" />)}
                  {countries.filter((c) => metric(c) > 0).map((c) => {
                    const p = project(COUNTRIES[c.country].lat, COUNTRIES[c.country].lon);
                    return (
                      <g key={c.country}>
                        <title>{`${countryName(c.country)}: ${layer === "viewers" ? `${n(c.viewers)} viewers` : money(c.grossCents)}`}</title>
                        <circle cx={p.x} cy={p.y} r={9 + 16 * Math.sqrt(metric(c) / maxC)} fill="#f5a524" fillOpacity={0.25} />
                        <circle cx={p.x} cy={p.y} r={5} fill="#f5a524" />
                      </g>
                    );
                  })}
                </svg>
              </div>
            </section>
            <section className="bp-panel stan-top" aria-label="Top countries">
              <h2>Top countries</h2>
              {countries.length ? (
                <table>
                  <thead><tr><th scope="col">Country</th><th scope="col">Viewers</th><th scope="col">Tickets</th></tr></thead>
                  <tbody>
                    {countries.slice(0, 8).map((c) => <tr key={c.country}><td>{countryName(c.country)}</td><td>{n(c.viewers)}</td><td className="am">{money(c.grossCents, "USD", true)}</td></tr>)}
                  </tbody>
                </table>
              ) : <p className="pt-hint">Countries appear once people watch or buy seats in this period.</p>}
            </section>
          </div>

          <div className="stan-three">
            <section className="bp-panel" id="languages" aria-label="Audio language chosen">
              <h2>Audio language chosen</h2>
              {audio.length ? (
                <>
                  <Bars items={audio} color="#8b7cf6" />
                  <p className="stan-note">{dubbed ? `${n(dubbed)} ${dubbed === 1 ? "viewer" : "viewers"} chose a dubbed language; ${n(original)} kept the original.` : "Everyone kept the original audio so far."}</p>
                </>
              ) : <p className="pt-hint">Languages appear once people watch in this period.</p>}
            </section>
            <section className="bp-panel stan-funnel" id="funnel" aria-label="Ticket funnel">
              <h2>Ticket funnel · all films</h2>
              <ol>
                <li><span>Saw a clip</span><b className="soon">Soon</b></li>
                <li><span>Opened film page</span><b className="soon">Soon</b></li>
                <li><span>Bought a seat</span><b style={{ width: "100%" }}>{n(d.funnel.seats)} {d.funnel.seats === 1 ? "seat" : "seats"} · {n(d.funnel.orders)} {d.funnel.orders === 1 ? "order" : "orders"}</b></li>
                <li><span>Gifted a seat</span><b style={{ width: `${d.funnel.seats ? Math.max(18, Math.min(100, (d.funnel.gifts / d.funnel.seats) * 100)) : 18}%` }}>{n(d.funnel.gifts)}</b></li>
              </ol>
              <p className="pt-hint">Clip views and film page visits are counted once page analytics are switched on.</p>
            </section>
            <section className="bp-panel stan-cohort" id="cohorts" aria-label="Repeat viewers by first month">
              <h2>Repeat viewers by first month</h2>
              {d.cohorts.length ? (
                <>
                  <table>
                    <thead><tr><th />{["M0", "M1", "M2", "M3"].map((h) => <th key={h} scope="col">{h}</th>)}</tr></thead>
                    <tbody>
                      {d.cohorts.slice(-4).map((c) => (
                        <tr key={c.month}>
                          <th scope="row">{MONTHS[Number(c.month.slice(5, 7)) - 1]}</th>
                          <td><b title={`${n(c.size)} first-time viewers`}>100%</b></td>
                          {[0, 1, 2].map((k) => <td key={k}>{c.back[k] !== undefined ? <b style={{ opacity: 0.35 + 0.65 * c.back[k] }}>{pct(c.back[k])}</b> : <i />}</td>)}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {cohortNote && <p className="stan-note">{pct(cohortNote.back[0])} of {MONTHS[Number(cohortNote.month.slice(5, 7)) - 1]}&apos;s first-time viewers came back the month after.</p>}
                </>
              ) : <p className="pt-hint">Cohorts appear once people have watched your films.</p>}
            </section>
          </div>

          <section className="bp-panel" id="money" aria-label="Money">
            <h2>Money</h2>
            <div className="stcr-tiles">
              <Tile label="Gross" value={money(m.grossCents, "USD", true)} sub="tickets bought, in US dollars" up />
              <Tile label={`Platform ${100 - share}%`} value={money(m.platformCents, "USD", true)} sub="after refunds" />
              <Tile label="Refunds and chargebacks" value={m.grossCents ? `${((m.refundCents / m.grossCents) * 100).toFixed(1)}%` : "–"} sub={money(m.refundCents)} />
              <Tile label={`Your ${share}%`} value={money(m.shareCents, "USD", true)} sub="paid after each screening ends" />
              <Tile label="Revenue per viewer" value={m.buyers ? money(m.perViewerCents) : "–"} sub={`${n(m.buyers)} ${m.buyers === 1 ? "buyer" : "buyers"}`} />
            </div>
          </section>
        </>
      )}
    </div>
  );
}
