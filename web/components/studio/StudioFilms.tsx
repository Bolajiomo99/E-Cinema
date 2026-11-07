"use client";
import Link from "next/link";
import { useState } from "react";
import { money, type Film } from "@/lib/studio-types";

// Figma "Studio / Films" (34:458): one row per film (its encores folded in), filtered by state.
// startsAt is the screening that matters now: the live one, else the next, else the premiere.
export type FilmRow = Film & { kind: string; dubs: number; screenings: number; upcoming: number };
const POSTERS = ["#1d1440", "#3d0f2e", "#0f3324", "#2b2f36", "#0c2a3a", "#3b2a0a"];

// Built by hand so the server and the browser print exactly the same text.
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function premiere(iso: string, now: number) {
  const lagos = (ms: number) => new Date(ms + 60 * 60 * 1000); // Lagos is UTC+1 all year
  const d = lagos(Date.parse(iso)), n = lagos(now);
  if (d.toISOString().slice(0, 10) === n.toISOString().slice(0, 10)) return `Today ${d.toISOString().slice(11, 16)}`;
  const date = `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
  return d > n ? `${DAYS[d.getUTCDay()]} ${date}` : date;
}

export type DraftRow = { id: string; title: string; files: number; saved: string };

export default function StudioFilms({ films, drafts, now }: { films: FilmRow[]; drafts: DraftRow[]; now: number }) {
  const [tab, setTab] = useState<"all" | Film["state"]>("all");
  const count = (s: Film["state"]) => films.filter((f) => f.state === s).length;
  const titles = films.length;
  const screenings = films.reduce((n, f) => n + f.upcoming, 0);
  const shown = tab === "all" ? films : films.filter((f) => f.state === tab);
  return (
    <div className="pt-body">
      <header className="bp-head">
        <div>
          <h1>Films</h1>
          <p>{titles} {titles === 1 ? "title" : "titles"} · {screenings} upcoming {screenings === 1 ? "screening" : "screenings"} · {count("live")} live</p>
        </div>
        <Link className="vf-btn red" href="/studio/upload">Upload a film</Link>
      </header>
      <div className="bp-chips" role="tablist" aria-label="Filter films">
        {([["all", `All ${films.length}`], ["live", `Live ${count("live")}`], ["upcoming", `Upcoming ${count("upcoming")}`], ["ended", `Ended ${count("ended")}`]] as const).map(([k, t]) => (
          <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>{t}</button>
        ))}
      </div>
      {shown.length ? (
        <div className="stu-films" role="table" aria-label="Your films">
          <div className="stu-fr hdr" role="row"><span role="columnheader">Title</span><span role="columnheader">Status</span><span role="columnheader">Next screening</span><span role="columnheader">Languages</span><span role="columnheader">Tickets</span><span role="columnheader">Gross</span><span /></div>
          {shown.map((f, i) => (
            <div key={f.origin || f.showtimeId} className="stu-fr" role="row">
              <span className="stu-ft" role="cell">
                <i className="stu-poster sm" style={{ background: `linear-gradient(180deg, ${POSTERS[i % POSTERS.length]}, #000)` }} aria-hidden />
                <span><b>{f.film.toUpperCase()}</b><small>{f.kind}</small></span>
              </span>
              <span role="cell">
                {f.state === "live" ? <span className="stu-badge"><i />LIVE</span> : f.state === "upcoming" ? <span className="stu-tag white">ON SALE</span> : <span className="stu-tag">{f.payout === "sent" ? "PAID OUT" : "ENDED"}</span>}
              </span>
              <span role="cell" className="stu-mut">{premiere(f.startsAt, now)}{f.screenings > 1 && <small>{f.screenings} screenings</small>}</span>
              <span role="cell" className="stu-mut">{f.dubs ? `${f.dubs + 1} audio` : "Original audio"}</span>
              <span role="cell"><b>{f.seats ? f.seats.toLocaleString("en-GB") : "—"}</b></span>
              <span role="cell"><b>{f.grossCents ? money(f.grossCents, f.currency, true) : "—"}</b></span>
              <span role="cell"><Link className="vf-btn sm" href={f.uploadId ? `/studio/films/${f.uploadId}` : `/film/${f.showtimeId}`}>View</Link></span>
            </div>
          ))}
        </div>
      ) : <p className="pt-empty">{films.length ? "No films in this view." : "Your films show here once their first premiere is booked."}</p>}
      {drafts.length > 0 && (
        <section className="bp-panel">
          <h2>In preparation</h2>
          <ul className="stup-drafts">
            {drafts.map((d) => (
              <li key={d.id}>
                <div><b>{d.title}</b><small>Draft · {d.files} {d.files === 1 ? "file" : "files"} · saved {d.saved}</small></div>
                <Link className="vf-btn sm" href={`/studio/films/${d.id}`}>Open</Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
