"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { COUNTRIES, MAP_H, MAP_W, SWATCHES, countryName, dots, project } from "@/lib/worldmap";

export type MapFilm = { id: string; film: string; language?: string; startsAt: string; endsAt: number; poster?: { from: string; via: string; to: string; glow: string }; seatsLeft?: number };
type Live = { showtimeId: string; watching: number; countries: number; byCountry?: Record<string, number>; chatByCountry?: Record<string, number> };
type Tonight = { showtimeId: string; seats: number; byCountry: Record<string, number> };
type Mode = "live" | "tonight";
type Heat = "viewers" | "chat";

const n = (v: number) => v.toLocaleString("en-US");
const k = (v: number) => (v >= 1000 ? new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(v) : String(v));
const LAND = dots();

// Per-country totals across rooms, plus which room leads in each country.
function tally(rows: { id: string; by: Record<string, number> }[]) {
  const total = new Map<string, number>(), rooms = new Map<string, number>(), top = new Map<string, { id: string; v: number }>();
  for (const r of rows) {
    for (const [cc, v] of Object.entries(r.by)) {
      if (!v) continue;
      total.set(cc, (total.get(cc) ?? 0) + v);
      rooms.set(cc, (rooms.get(cc) ?? 0) + 1);
      if (!top.has(cc) || top.get(cc)!.v < v) top.set(cc, { id: r.id, v });
    }
  }
  return { total, rooms, top };
}

// Figma "Web / World map · live" (32:1201): live rooms by home country, refreshed every 5 seconds.
export default function WorldMap({ films, initialLive, initialTonight, home }: { films: MapFilm[]; initialLive: Live[]; initialTonight: Tonight[]; home?: string }) {
  const [mode, setMode] = useState<Mode>("live");
  const [heat, setHeat] = useState<Heat>("viewers");
  const [live, setLive] = useState(initialLive);
  const [tonight, setTonight] = useState(initialTonight);
  const [picked, setPicked] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [focus, setFocus] = useState<{ x: number; y: number } | null>(null);

  useEffect(() => {
    let stop = false;
    const tick = async () => {
      if (document.hidden) return;
      const [l, t] = await Promise.all([
        fetch("/api/live").then((r) => r.json()).catch(() => null),
        fetch("/api/audience/tonight").then((r) => r.json()).catch(() => null),
      ]);
      if (stop) return;
      if (Array.isArray(l)) setLive(l);
      if (Array.isArray(t)) setTonight(t);
    };
    const id = setInterval(tick, 5000);
    return () => { stop = true; clearInterval(id); };
  }, []);

  const film = useMemo(() => new Map(films.map((f) => [f.id, f])), [films]);
  const rows = mode === "tonight"
    ? tonight.map((t) => ({ id: t.showtimeId, by: t.byCountry }))
    : live.map((l) => ({ id: l.showtimeId, by: (heat === "chat" ? l.chatByCountry : l.byCountry) ?? {} }));
  const { total, rooms, top } = tally(rows);
  const ranked = [...total.entries()].filter(([cc]) => COUNTRIES[cc]).sort((a, b) => b[1] - a[1]);
  const colour = new Map(ranked.slice(0, 5).map(([cc], i) => [cc, SWATCHES[i]]));
  const max = ranked[0]?.[1] ?? 1;

  const headline = mode === "tonight" ? tonight.reduce((a, t) => a + t.seats, 0) : heat === "chat" ? [...total.values()].reduce((a, v) => a + v, 0) : live.reduce((a, l) => a + l.watching, 0);
  const roomCount = mode === "tonight" ? tonight.length : live.length;
  const sel = picked && total.has(picked) ? picked : ranked[0]?.[0] ?? null;
  const selPos = sel ? project(COUNTRIES[sel].lat, COUNTRIES[sel].lon) : null;

  // Zoom keeps the chosen point in the middle of the frame.
  const w = MAP_W / zoom, h = MAP_H / zoom;
  const c = focus ?? { x: MAP_W / 2, y: MAP_H / 2 };
  const vb = { x: Math.min(Math.max(c.x - w / 2, 0), MAP_W - w), y: Math.min(Math.max(c.y - h / 2, 0), MAP_H - h), w, h };
  const toPct = (p: { x: number; y: number }) => ({ left: `${((p.x - vb.x) / vb.w) * 100}%`, top: `${((p.y - vb.y) / vb.h) * 100}%` });

  const leadFilm = sel ? film.get(top.get(sel)?.id ?? "") : undefined;
  const label = mode === "tonight" ? "Seats booked for tonight" : heat === "chat" ? "Chat messages, last 10 min" : "Watching right now";
  const unit = mode === "tonight" ? "seats" : heat === "chat" ? "messages" : "watching";

  return (
    <div className="wm">
      <div className="wm-chips" role="group" aria-label="Map view">
        <button type="button" className={`br-chip${mode === "live" ? " on" : ""}`} aria-pressed={mode === "live"} onClick={() => setMode("live")}>Live now</button>
        <button type="button" className={`br-chip${mode === "tonight" ? " on" : ""}`} aria-pressed={mode === "tonight"} onClick={() => setMode("tonight")}>Tonight</button>
        <button type="button" className={`br-chip${heat === "viewers" ? " on" : ""}`} aria-pressed={heat === "viewers"} onClick={() => setHeat("viewers")}>Heat: viewers</button>
        <button type="button" className={`br-chip${heat === "chat" ? " on" : ""}`} aria-pressed={heat === "chat"} disabled={mode === "tonight"} title={mode === "tonight" ? "Chat opens when the room does" : undefined} onClick={() => setHeat("chat")}>Heat: chat</button>
      </div>

      <section className="wm-map" aria-label="World map of live audiences">
        <div className="wm-world">
          <svg viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`} preserveAspectRatio="xMidYMid meet" role="img" aria-label={ranked.length ? `${ranked.length} countries ${mode === "tonight" ? "with seats booked" : "watching"}` : "No one is watching right now"}>
            {LAND.map((d, i) => <circle key={i} cx={d.x} cy={d.y} r={3.74} className="wm-dot" />)}
            {ranked.map(([cc, v]) => {
              const p = project(COUNTRIES[cc].lat, COUNTRIES[cc].lon);
              const r = 9 + 19 * Math.sqrt(v / max);
              const col = colour.get(cc) ?? "#e3182d";
              return (
                <g key={cc} className={`wm-spot${cc === sel ? " on" : ""}`} onClick={() => setPicked(cc)} role="button" tabIndex={0} aria-label={`${countryName(cc)}: ${n(v)} ${unit}`} onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && setPicked(cc)}>
                  <circle cx={p.x} cy={p.y} r={r} fill={col} fillOpacity={0.22} stroke={col} strokeOpacity={0.6} />
                  <circle cx={p.x} cy={p.y} r={Math.max(4, r / 4.6)} fill={col} />
                </g>
              );
            })}
          </svg>

          {sel && selPos && (
            <div className="wm-city" style={toPct(selPos)}>
              <div className="wm-city-h">
                <strong>{COUNTRIES[sel].name}</strong>
                {mode === "live" ? <span className="lp-badge live"><i />LIVE</span> : <span className="lp-badge outline">TONIGHT</span>}
              </div>
              <p>{n(total.get(sel)!)} {unit} · {rooms.get(sel)} {mode === "tonight" ? "screening" : "room"}{rooms.get(sel) === 1 ? "" : "s"}</p>
              {leadFilm && <p>Top: {leadFilm.film}{leadFilm.language ? ` (${leadFilm.language})` : ""}</p>}
              {leadFilm && <Link href={`/film/${leadFilm.id}`} className="lp-btn sm primary">{mode === "tonight" ? "Get a seat" : `Join a ${countryName(sel, true)} room`}</Link>}
            </div>
          )}
        </div>

        <aside className="wm-legend" aria-live="polite">
          <small>{label}</small>
          <b>{n(headline)}</b>
          <p>
            {headline
              ? `in ${n(ranked.length)} ${ranked.length === 1 ? "country" : "countries"} across ${n(roomCount)} ${mode === "tonight" ? "screening" : "live room"}${roomCount === 1 ? "" : "s"}`
              : mode === "tonight" ? "No seats booked for the next 24 hours yet." : heat === "chat" ? "No one has chatted in the last 10 minutes." : "No one is in a live room right now."}
          </p>
          {ranked.length > 0 && <hr />}
          {ranked.slice(0, 5).map(([cc, v]) => (
            <button type="button" key={cc} className={`wm-row${cc === sel ? " on" : ""}`} onClick={() => setPicked(cc)}>
              <span><i style={{ background: colour.get(cc) }} />{countryName(cc, true)}</span>
              <em>{k(v)}</em>
            </button>
          ))}
        </aside>

        <div className="wm-zoom" role="group" aria-label="Zoom">
          <button type="button" aria-label="Zoom in" disabled={zoom >= 4} onClick={() => { setFocus(selPos ?? c); setZoom((z) => Math.min(4, z * 2)); }}>
            <svg viewBox="0 0 18 18" aria-hidden><path d="M9 3v12M3 9h12" /></svg>
          </button>
          <button type="button" aria-label="Zoom out" disabled={zoom <= 1} onClick={() => setZoom((z) => Math.max(1, z / 2))}>
            <svg viewBox="0 0 18 18" aria-hidden><path d="M3 9h12" /></svg>
          </button>
          <button type="button" aria-label={home && COUNTRIES[home] ? `Show ${COUNTRIES[home].name}` : "Show the whole world"} onClick={() => {
            if (home && COUNTRIES[home]) { setFocus(project(COUNTRIES[home].lat, COUNTRIES[home].lon)); setZoom(2); if (total.has(home)) setPicked(home); }
            else { setFocus(null); setZoom(1); }
          }}>
            <svg viewBox="0 0 18 18" aria-hidden><circle cx="9" cy="9" r="5" /><path d="M9 1v3M9 14v3M1 9h3M14 9h3" /></svg>
          </button>
        </div>
      </section>

      <RoomStrip films={films} live={live} />
    </div>
  );
}

function RoomStrip({ films, live }: { films: MapFilm[]; live: Live[] }) {
  const now = Date.now();
  const liveBy = new Map(live.map((l) => [l.showtimeId, l]));
  const onNow = films.filter((f) => Date.parse(f.startsAt) <= now && f.endsAt > now).sort((a, b) => (liveBy.get(b.id)?.watching ?? 0) - (liveBy.get(a.id)?.watching ?? 0));
  const next = films.filter((f) => Date.parse(f.startsAt) > now);
  const list = [...onNow, ...next].slice(0, 4);
  return (
    <section className="wm-strip" aria-label="Rooms">
      {list.map((f) => {
        const l = liveBy.get(f.id);
        const isLive = Date.parse(f.startsAt) <= now;
        const day = new Date(f.startsAt).toLocaleDateString("en-GB", { weekday: "short" });
        return (
          <Link key={f.id} href={`/film/${f.id}`} className="wm-room" data-id={f.id}>
            <span className="wm-poster" style={{ background: f.poster ? `linear-gradient(180deg, ${f.poster.from} 0%, ${f.poster.via} 60%, ${f.poster.to} 100%)` : "#1b1b21" }} aria-hidden>
              {f.poster && <span className="lp-poster-glow" style={{ background: f.poster.glow }} />}
            </span>
            <span>
              <strong>{f.film.toUpperCase()}</strong>
              <small suppressHydrationWarning>
                {l?.watching
                  ? `${k(l.watching)} · ${l.countries} ${l.countries === 1 ? "country" : "countries"}`
                  : isLive ? "live · room open"
                  : f.seatsLeft === 0 ? "sold out · lottery" : `starts ${day}${f.seatsLeft ? ` · ${k(f.seatsLeft)} seats` : ""}`}
              </small>
            </span>
          </Link>
        );
      })}
    </section>
  );
}
