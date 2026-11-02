"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import type { LiveData } from "@/lib/exec";
import { countryName } from "@/lib/worldmap";

// Live operations (Figma 82:852). Audience numbers come straight from the watch-room hub and
// refresh every 10 seconds. Stream health, sync drift and incidents need player telemetry and
// carry "Soon" until it exists.
const REGION: Record<string, string> = {};
const put = (r: string, cc: string) => cc.split(" ").forEach((c) => { REGION[c] = r; });
put("Africa", "NG GH SN CI BJ TG SL LR GM BF ML NE GN CV KE UG TZ RW ET SO ZA ZW ZM BW NA MZ MW AO CM CD CG GA EG MA DZ TN SD");
put("Europe", "GB IE FR DE ES PT IT NL BE CH AT SE NO DK FI PL CZ GR RO HU UA");
put("South Asia", "IN PK BD LK NP");
put("Americas", "US CA MX BR AR CO CL PE VE EC JM TT");
put("East Asia", "CN JP KR ID PH VN TH MY SG");
put("Gulf", "AE SA QA KW OM BH TR IL JO LB");
const k = (v: number) => (v >= 1e6 ? `${(v / 1e6).toFixed(2)}M` : v >= 1e4 ? `${Math.round(v / 1e3)}k` : v.toLocaleString("en-US"));
function lagos(iso: string) {
  const d = new Date(Date.parse(iso) + 3600_000);
  return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")} WAT`;
}

export default function ExecLive({ initial }: { initial: LiveData }) {
  const [d, setD] = useState(initial);
  useEffect(() => {
    const t = setInterval(() => {
      fetch("/api/executive/live").then((r) => (r.ok ? r.json() : null)).then((j) => { if (j) setD(j); }).catch(() => {});
    }, 10_000);
    return () => clearInterval(t);
  }, []);
  const online = d.playing.reduce((s, p) => s + p.watching, 0);
  const peak = Math.max(0, ...d.playing.map((p) => p.peak));
  const regions = new Map<string, number>();
  for (const p of d.playing) for (const [cc, v] of Object.entries(p.byCountry ?? {})) {
    const r = REGION[cc] ?? "Other";
    regions.set(r, (regions.get(r) ?? 0) + v);
  }
  const reg = [...regions.entries()].sort((a, b) => b[1] - a[1]);
  const maxR = Math.max(1, ...reg.map((r) => r[1]));
  const where = (by: Record<string, number>) => {
    const top = Object.entries(by ?? {}).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([cc]) => countryName(cc, true));
    return top.length ? top.join(", ") : "–";
  };

  return (
    <section className="exc exl">
      <header className="exc-head">
        <div>
          <h1>Live operations</h1>
          <p className="exc-sub">Everything playing right now across the world: premieres, rooms and audiences. Refreshes every 10 seconds.</p>
        </div>
        <div className="exc-chips">
          <span className="exl-live"><i />LIVE</span>
          <span className="exl-war" aria-disabled="true">Open war room<em className="soon-tag">Soon</em></span>
        </div>
      </header>

      <div className="exc-tiles exg-tiles">
        <div className="exc-tile"><span>Online now</span><b>{k(online)}</b><small className="up">{peak ? `biggest room peaked at ${k(peak)}` : "no one watching yet"}</small></div>
        <div className="exc-tile"><span>Rooms live</span><b>{d.playing.length}</b><small className="up">{d.playing.length ? `avg ${Math.round(online / d.playing.length)} people` : "nothing playing"}</small></div>
        <div className="exc-tile soon"><span>Sync drift<em className="soon-tag">Soon</em></span><small>Needs player telemetry</small></div>
        <div className="exc-tile soon"><span>Rebuffering<em className="soon-tag">Soon</em></span><small>Needs player telemetry</small></div>
      </div>

      <div className="exc-card exl-card">
        <h2>Premieres playing now</h2>
        <div className="exn-table" role="table" aria-label="Premieres playing now">
          <div className="exn-th exl-g" role="row"><span>Film</span><span>Started</span><span>Watching</span><span>Regions</span><span>Health</span><span /></div>
          {d.playing.map((p) => (
            <div key={p.id} className="exn-tr exl-g" role="row">
              <span role="cell"><b>{p.film}</b><small className="exl-studio">{p.studio}</small></span>
              <span role="cell">{lagos(p.starts)}</span>
              <span role="cell"><b>{k(p.watching)}</b></span>
              <span role="cell">{where(p.byCountry)}</span>
              <span role="cell" className="exl-soon">Soon</span>
              <span role="cell" className="exl-act">
                <Link href={`/room/${p.id}`} className="exa-edit exn-btn">Watch</Link>
                <span className="exl-pause" aria-disabled="true" title="Pausing a premiere is coming soon">Pause</span>
              </span>
            </div>
          ))}
          {!d.playing.length && <p className="exc-empty">Nothing is playing right now.</p>}
        </div>
      </div>

      <div className="exc-row exn-row">
        <div className="exc-card">
          <h2>Region health</h2>
          {reg.length ? (
            <div className="exg-plans exl-reg">
              {reg.map(([r, v]) => <div key={r}><span>{r}</span><i><b style={{ width: `${(v / maxR) * 100}%`, background: "#22c55e" }} /></i><strong>{k(v)} online</strong></div>)}
            </div>
          ) : <p className="exc-empty">No one is in a watch room right now.</p>}
          <p className="exm-note">People in watch rooms by home region. Stream health per region is coming soon.</p>
        </div>
        <div className="exc-card">
          <h2>Incidents<em className="soon-tag">Soon</em></h2>
          <p className="exc-empty">Incidents will show here once uptime alerts are connected. Uptime checks already run on the API and checkout every few minutes.</p>
          <p className="exm-note">Only the CEO and the CTO will be able to pause a premiere.</p>
        </div>
      </div>
    </section>
  );
}
