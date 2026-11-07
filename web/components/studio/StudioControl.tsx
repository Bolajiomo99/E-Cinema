"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { COUNTRIES, MAP_H, MAP_W, countryName, dots, project } from "@/lib/worldmap";
import { dubName } from "@/lib/dub-types";
import { scall } from "./scall";

// Figma "Studio / Live control room" (37:1272): the audience of a premiere as it happens. Counts
// refresh every five seconds; Studio AI reads the chat's mood every two minutes.

type Report = { messageId: number; name: string; country: string; body: string; kind: string; reasons: string[]; reporters: number; hidden: boolean; status: "open" | "actioned" | "dismissed"; at: string };
export type ControlData = {
  control: { showtimeId: string; film: string; startsAt: string; durationMin: number; messages: number; spoilers: number; autoHidden: number; reports: Report[]; phrases: { lang: string; body: string; count: number }[] };
  live: { watching: number; countries: number; byCountry: Record<string, number>; chatByCountry: Record<string, number> };
  peak: { watching: number; at: string };
  studio: string;
  // Player reports: the last five minutes while the room is open, the whole screening otherwise.
  quality?: { reports: number; inSync: number | null; rebuffer: number | null; driftMs: number | null; startMs: number | null; startP95Ms: number | null; countries?: Record<string, { reports: number; driftMs: number }> };
};
type Mood = { positive: number; summary: string; points: { at: string; positive: number }[]; read: number };

const LAND = dots();
const n = (v: number) => v.toLocaleString("en-US");
const REASONS: Record<string, string> = { harassment: "Harassment", hate: "Hate", spoilers: "Spoiler", spam: "Spam", recording: "Recording the film", under13: "Under 13", other: "Other" };
const wat = (iso: string) => new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Lagos", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(iso));
const watDay = (iso: string) => new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Lagos", weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(iso));
function span(ms: number) {
  const m = Math.max(0, Math.round(ms / 60_000));
  if (m >= 1440) return `${Math.floor(m / 1440)}d ${Math.floor((m % 1440) / 60)}h`;
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`;
}

function Tile({ label, value, note, tone }: { label: string; value: string | null; note: string; tone?: "g" | "r" | "" }) {
  return (
    <div className={`stcr-tile${value === null ? " soon" : ""}`}>
      <small>{label}</small>
      <b>{value ?? "–"}</b>
      <span className={tone ?? ""}>{note}</span>
    </div>
  );
}
const pct = (v: number) => `${Math.round(v * 1000) / 10}%`;
const secs = (ms: number) => `${(ms / 1000).toFixed(1)}s`;
// Green, amber or red for a health dot; "off" when nothing has been reported.
const tone = (v: number | null | undefined, good: (x: number) => boolean, ok: (x: number) => boolean) => (v == null ? "off" : good(v) ? "" : ok(v) ? "warn" : "bad");
const driftColor = (ms: number) => (ms <= 250 ? "#22c55e" : ms <= 1000 ? "#f5a524" : "#ff4d5e");

export default function StudioControl({ upload, films, initial, canEdit }: { upload: string; films: { id: string; title: string }[]; initial: ControlData; canEdit: boolean }) {
  const [d, setD] = useState(initial);
  const [now, setNow] = useState(() => Date.parse(initial.control.startsAt) - 1); // fixed until mounted, so server and browser agree
  const [mood, setMood] = useState<Mood | null>(null);
  const [moodNote, setMoodNote] = useState("Reading the chat");
  const [composing, setComposing] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");

  const c = d.control;
  const start = Date.parse(c.startsAt), end = start + c.durationMin * 60_000;
  const live = now >= start && now < end;
  const status = now < start ? `Starts ${watDay(c.startsAt)} WAT · in ${span(start - now)}` : live ? `Started ${wat(c.startsAt)} WAT · ${span(now - start)} in · ${span(end - now)} left` : `Ended ${wat(new Date(end).toISOString())} WAT`;
  const ranked = Object.entries(d.live.byCountry ?? {}).filter(([cc, v]) => v > 0 && COUNTRIES[cc]).sort((a, b) => b[1] - a[1]);
  const max = ranked[0]?.[1] ?? 1;
  const chatPerMin = Object.values(d.live.chatByCountry ?? {}).reduce((a, b) => a + b, 0) / 10;
  const open = c.reports.filter((r) => r.status === "open");
  const q = d.quality;
  const spanText = live ? "in the last 5 minutes" : "across the screening";
  const [mapMode, setMapMode] = useState<"viewers" | "drift">("viewers");
  const drifted = Object.entries(q?.countries ?? {}).filter(([cc, v]) => v.reports > 0 && COUNTRIES[cc]).sort((a, b) => b[1].reports - a[1].reports);
  const maxReports = drifted[0]?.[1].reports ?? 1;

  const refresh = useCallback(async () => {
    try { setD(await scall<ControlData>("GET", `uploads/${upload}/control`)); } catch { /* next tick */ }
  }, [upload]);
  const readMood = useCallback(async () => {
    try {
      const r = await scall<{ mood: Mood | null; why?: string }>("POST", `uploads/${upload}/control/mood`);
      setMood(r.mood);
      setMoodNote(r.mood ? "" : r.why === "off" ? "Studio AI is not switched on yet." : "Not enough chat yet to read the mood.");
    } catch (e) { setMoodNote((e as Error).message); }
  }, [upload]);

  useEffect(() => {
    const first = setTimeout(() => setNow(Date.now()), 0);
    const tick = setInterval(() => setNow(Date.now()), 15_000);
    const poll = setInterval(refresh, 5_000);
    const t = setTimeout(readMood, 0);
    const m = setInterval(readMood, 120_000);
    return () => { clearTimeout(first); clearInterval(tick); clearInterval(poll); clearInterval(m); clearTimeout(t); };
  }, [refresh, readMood]);

  async function send() {
    setErr(""); setMsg(""); setBusy("send");
    try {
      const r = await scall<{ reached: number }>("POST", `uploads/${upload}/control/announce`, { text });
      setMsg(r.reached ? `Sent to ${n(r.reached)} ${r.reached === 1 ? "screen" : "screens"} in the room.` : "Sent. Nobody is in the room right now, so no one saw it.");
      setText(""); setComposing(false);
    } catch (e) { setErr((e as Error).message); } finally { setBusy(""); }
  }
  async function moderate(r: Report, hide: boolean) {
    setErr(""); setBusy(`m${r.messageId}`);
    try {
      await scall("POST", `uploads/${upload}/control/moderate`, { messageId: r.messageId, hide });
      await refresh();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(""); }
  }

  // The mood line, drawn like the Figma sparkline: positive share from 50% (bottom) to 100% (top).
  const W = 290, H = 66;
  const pts = (mood?.points ?? []).map((p, i, a) => ({ x: a.length > 1 ? (i / (a.length - 1)) * W : W / 2, y: H - (Math.max(50, p.positive) - 50) / 50 * (H - 6) - 3 }));
  const line = pts.map((p, i) => `${i ? "L" : "M"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");

  return (
    <div className="pt-body stcr">
      <header className="bp-head">
        <div>
          <h1>{c.film} · live premiere</h1>
          <p suppressHydrationWarning>{status}</p>
        </div>
        <div className="pt-btns">
          {live && <span className="stcr-live">LIVE</span>}
          {canEdit && <button className="vf-btn ghost" onClick={() => { setComposing(!composing); setMsg(""); }}>Message all viewers</button>}
          {canEdit && <button className="vf-btn red" disabled title="Coming soon">Emergency pause <em className="soon-tag">Soon</em></button>}
        </div>
      </header>
      {films.length > 1 && (
        <nav className="bp-chips" aria-label="Premieres">
          {films.map((f) => <Link key={f.id} className={`stpr-film${f.id === upload ? " on" : ""}`} href={`/studio/control?film=${f.id}`} aria-current={f.id === upload ? "page" : undefined}>{f.title}</Link>)}
        </nav>
      )}
      {composing && (
        <section className="bp-panel stcr-say">
          <label className="vf-field"><span>A message on every screen in the room, from {d.studio}</span>
            <div className="vf-box"><textarea value={text} maxLength={280} rows={2} onChange={(e) => setText(e.target.value)} placeholder="Thank you for watching with us tonight" /></div>
          </label>
          <div className="pt-btns">
            <small>{text.length}/280 · one message a minute</small>
            <button className="vf-btn ghost" onClick={() => setComposing(false)}>Cancel</button>
            <button className="vf-btn red" disabled={!text.trim() || Boolean(busy)} onClick={send}>{busy === "send" ? "Sending" : "Send to everyone"}</button>
          </div>
        </section>
      )}
      {msg && <p className="bp-flash" role="status">{msg}</p>}
      {err && <p className="vf-err" role="alert">{err}</p>}

      <div className="stcr-tiles">
        <div className="stcr-tile">
          <small>Watching now</small>
          <b>{n(d.live.watching)}</b>
          <span className="g" suppressHydrationWarning>{d.peak.watching ? `peak ${n(d.peak.watching)} at ${wat(d.peak.at)}` : "No one in the room yet"}</span>
        </div>
        <div className="stcr-tile">
          <small>Countries</small>
          <b>{n(d.live.countries)}</b>
          <span className="g">{ranked.length ? `${ranked.slice(0, 3).map(([cc]) => countryName(cc, true)).join(", ")} ${ranked.length > 1 ? "lead" : "watching"}` : "Waiting for the first viewer"}</span>
        </div>
        <Tile label="In sync (±250 ms)" value={q?.inSync != null ? pct(q.inSync) : null} tone={q?.inSync != null ? (q.inSync >= 0.95 ? "g" : "r") : ""}
          note={q?.reports ? `${n(q.reports)} player ${q.reports === 1 ? "report" : "reports"} ${spanText}` : "No player reports yet"} />
        <Tile label="Rebuffering" value={q?.rebuffer != null ? pct(q.rebuffer) : null} tone={q?.rebuffer != null ? (q.rebuffer < 0.01 ? "g" : "r") : ""}
          note={q?.rebuffer != null ? `of watch time spent loading ${spanText}` : "No player reports yet"} />
        <Tile label="Avg start time" value={q?.startMs != null ? secs(q.startMs) : null} tone={q?.startMs != null ? (q.startMs <= 3000 ? "g" : "r") : ""}
          note={q?.startP95Ms != null ? `95% start within ${secs(q.startP95Ms)}` : "Measured when viewers join"} />
      </div>

      <div className="stcr-row">
        <section className="bp-panel stcr-map" aria-label="Viewers right now">
          <div className="stcr-ph">
            <h2>Viewers right now</h2>
            <div className="bp-chips">
              <button type="button" className={mapMode === "viewers" ? "on" : ""} aria-pressed={mapMode === "viewers"} onClick={() => setMapMode("viewers")}>Viewers</button>
              <button type="button" disabled title="Coming soon">Sentiment <em className="soon-tag">Soon</em></button>
              <button type="button" className={mapMode === "drift" ? "on" : ""} aria-pressed={mapMode === "drift"} onClick={() => setMapMode("drift")}>Sync drift</button>
            </div>
          </div>
          <div className="stcr-world">
            <svg viewBox={`0 0 ${MAP_W} ${MAP_H}`} preserveAspectRatio="xMidYMid meet" role="img" aria-label={ranked.length ? `${ranked.length} countries watching` : "No one is watching right now"}>
              {LAND.map((p, i) => <circle key={i} cx={p.x} cy={p.y} r={3.4} className="stcr-dot" />)}
              {mapMode === "viewers" && ranked.map(([cc, v]) => {
                const p = project(COUNTRIES[cc].lat, COUNTRIES[cc].lon);
                const r = 9 + 16 * Math.sqrt(v / max);
                return (
                  <g key={cc}>
                    <title>{`${countryName(cc)}: ${n(v)} watching`}</title>
                    <circle cx={p.x} cy={p.y} r={r} fill="#f5a524" fillOpacity={0.25} />
                    <circle cx={p.x} cy={p.y} r={5} fill="#f5a524" />
                  </g>
                );
              })}
              {mapMode === "drift" && drifted.map(([cc, v]) => {
                const p = project(COUNTRIES[cc].lat, COUNTRIES[cc].lon);
                const r = 9 + 16 * Math.sqrt(v.reports / maxReports), col = driftColor(v.driftMs);
                return (
                  <g key={cc}>
                    <title>{`${countryName(cc)}: ${n(v.driftMs)} ms average drift`}</title>
                    <circle cx={p.x} cy={p.y} r={r} fill={col} fillOpacity={0.25} />
                    <circle cx={p.x} cy={p.y} r={5} fill={col} />
                  </g>
                );
              })}
            </svg>
          </div>
          {mapMode === "viewers" ? (
            <ul className="stcr-legend">
              {ranked.slice(0, 5).map(([cc, v]) => <li key={cc}><i />{countryName(cc)} · {n(v)}</li>)}
              {!ranked.length && <li className="none">Countries appear as viewers join the room.</li>}
            </ul>
          ) : (
            <ul className="stcr-legend">
              {drifted.slice(0, 5).map(([cc, v]) => <li key={cc}><i style={{ background: driftColor(v.driftMs) }} />{countryName(cc)} · {n(v.driftMs)} ms</li>)}
              {!drifted.length && <li className="none">Drift shows once players in the room send reports.</li>}
            </ul>
          )}
        </section>

        <div className="stcr-side">
          <section className="bp-panel stcr-health" aria-label="Delivery health">
            <h2>Delivery health</h2>
            <div className="stcr-cells">
              <div><small>CDN edge</small><b><i className={tone(q?.rebuffer, (x) => x < 0.01, (x) => x < 0.03)} />{q?.rebuffer != null ? `${pct(q.rebuffer)} rebuffering` : "Not reported yet"}</b></div>
              <div><small>Sync service</small><b><i className={tone(q?.inSync, (x) => x >= 0.95, (x) => x >= 0.8)} />{q?.inSync != null ? `${pct(q.inSync)} in sync` : "Not reported yet"}</b></div>
              <div><small>Chat gateway</small><b><i />{chatPerMin >= 10 ? n(Math.round(chatPerMin)) : chatPerMin.toFixed(1)} msgs/min</b></div>
              <div><small>ISP health <em className="soon-tag">Soon</em></small><b><i className="off" />Not reported yet</b></div>
            </div>
            <p className="pt-hint">From the players in the room, {spanText}. Automatic fixes (moving viewers to a nearer edge, pre-buffering) <em className="soon-tag">Soon</em></p>
          </section>

          <section className="bp-panel stcr-mood" aria-label="Audience mood">
            <h2>Audience mood</h2>
            {mood && pts.length ? (
              <svg viewBox={`0 0 ${W} ${H}`} className="stcr-spark" role="img" aria-label={`${mood.positive}% positive`}>
                <defs><linearGradient id="stcr-g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#22c55e" stopOpacity=".35" /><stop offset="1" stopColor="#22c55e" stopOpacity="0" /></linearGradient></defs>
                <path d={`${line} L${pts[pts.length - 1].x.toFixed(1)},${H} L${pts[0].x.toFixed(1)},${H} Z`} fill="url(#stcr-g)" />
                <path d={line} fill="none" stroke="#22c55e" strokeWidth="2" />
              </svg>
            ) : null}
            <p className="stcr-moodline">
              {mood ? `${mood.positive}% positive · ${mood.summary}` : moodNote}
              {c.spoilers > 0 && ` · ${n(c.spoilers)} spoiler ${c.spoilers === 1 ? "post" : "posts"} tagged`}
            </p>
          </section>
        </div>
      </div>

      <div className="stcr-row">
        <section className="bp-panel stcr-mod" aria-label="Moderation queue">
          <div className="stcr-ph">
            <h2>Moderation queue</h2>
            <small>Auto-hidden {n(c.autoHidden)} · needs you {n(open.length)}</small>
          </div>
          {c.reports.length ? (
            <ul>
              {c.reports.map((r) => (
                <li key={r.messageId}>
                  <span className="av" aria-hidden="true">{r.name.slice(0, 2).toUpperCase()}</span>
                  <div className="who">
                    <small>{r.name}{r.country ? ` · ${countryName(r.country)}` : ""} · {r.reasons.map((x) => REASONS[x] ?? x).join(", ")} · {r.reporters} {r.reporters === 1 ? "report" : "reports"}</small>
                    <p>{r.kind === "text" ? r.body : r.kind === "voice" ? "Voice note" : r.kind === "image" ? "Photo" : "File"}</p>
                  </div>
                  {r.status === "open" ? (
                    <div className="act">
                      {r.hidden && <em className="red">Hidden after {r.reporters} reports</em>}
                      {canEdit && <>
                        <button className="stdb-sbtn" disabled={Boolean(busy)} onClick={() => moderate(r, false)}>Keep</button>
                        <button className="stdb-sbtn red" disabled={Boolean(busy)} onClick={() => moderate(r, true)}>{r.hidden ? "Keep hidden" : "Hide"}</button>
                      </>}
                    </div>
                  ) : <em className={r.status === "actioned" ? "red" : "amber"}>{r.status === "actioned" ? "Removed by studio" : "Kept · reports closed"}</em>}
                </li>
              ))}
            </ul>
          ) : <p className="pt-hint">No reports. Viewers can report a message in the room; three reports hide it until you look.</p>}
        </section>

        <section className="bp-panel stcr-langs" aria-label="Top reactions by language">
          <h2>Top reactions by language</h2>
          {c.phrases.length ? (
            <ol>
              {c.phrases.map((p) => <li key={p.lang}><b>{dubName(p.lang)}</b><q>{p.body}</q><span>{n(p.count)}</span></li>)}
            </ol>
          ) : <p className="pt-hint">Lines three or more people say in the same language show here.</p>}
        </section>
      </div>
    </div>
  );
}
