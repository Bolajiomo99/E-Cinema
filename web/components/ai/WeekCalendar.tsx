"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { Showtime } from "@/lib/catalog";
import { useTickets } from "./tickets";

type Item = Pick<Showtime, "id" | "film" | "startsAt" | "price" | "category" | "adult" | "dubs" | "language"> & { endsAtMs: number; soon?: boolean };

const GENRES = [
  { id: "Nollywood", color: "#e3182d" },
  { id: "Bollywood", color: "#f2a516" },
  { id: "Hollywood", color: "#4696ff" },
  { id: "K-Drama", color: "#9b6bff" },
  { id: "18+", color: "#b91c1c" },
  { id: "Anime", color: "#ff8a3d" },
  { id: "Documentary", color: "#2bb7a8" },
];
const genreOf = (i: Item) => (i.adult ? "18+" : i.category ?? "Nollywood");
const colorOf = (g: string) => GENRES.find((x) => x.id === g)?.color ?? "#e3182d";
const hhmm = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
const dayStart = (ms: number) => { const d = new Date(ms); d.setHours(0, 0, 0, 0); return d.getTime(); };

// Home's release calendar: this week, in the viewer's time zone, with their own seats marked.
// Tap a premiere to book it; the full month view is the Bryntum calendar at /releases.
export default function WeekCalendar({ items }: { items: Item[] }) {
  const { tickets } = useTickets();
  const [now, setNow] = useState<number | null>(null);
  const [genre, setGenre] = useState("All");
  const [view, setView] = useState<"week" | "list">("week");
  const [offset, setOffset] = useState(0);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const first = setTimeout(tick, 0);
    const t = setInterval(tick, 60_000);
    return () => { clearTimeout(first); clearInterval(t); };
  }, []);

  const counts = useMemo(() => {
    const c: Record<string, number> = { All: items.length };
    for (const i of items) c[genreOf(i)] = (c[genreOf(i)] ?? 0) + 1;
    return c;
  }, [items]);
  const shown = items.filter((i) => genre === "All" || genreOf(i) === genre);
  const state = (i: Item) => {
    const t = tickets.find((x) => x.showtimeId === i.id);
    if (t?.status === "paid") return "mine";
    if (t?.status === "held") return "held";
    if (now !== null && now >= Date.parse(i.startsAt) && now < i.endsAtMs) return "live";
    if (i.soon) return "soon";
    return "";
  };
  const nextUp = now === null ? undefined : shown.find((i) => Date.parse(i.startsAt) > now && !i.soon);
  const base = dayStart(now ?? Date.parse(items[0]?.startsAt ?? "2026-11-01")) + offset * 7 * 86_400_000;
  const days = Array.from({ length: 7 }, (_, d) => base + d * 86_400_000);

  function card(i: Item) {
    const s = state(i);
    const g = genreOf(i);
    const start = Date.parse(i.startsAt);
    const href = s === "mine" || s === "live" ? `/room/${i.id}` : i.soon ? "/releases" : `/checkout?film=${i.id}`;
    return (
      <Link key={i.id} href={href} className={`hm-prem ${s}`} style={{ "--g": colorOf(g) } as React.CSSProperties}>
        <span className="hm-prem-top">
          <b>{hhmm(start)}</b>
          {s === "live" && <span className="lp-badge live"><i />LIVE</span>}
          {s === "mine" && <span className="lp-badge mine">YOUR SEAT</span>}
          {s === "held" && <span className="lp-badge vip">AI HELD</span>}
        </span>
        <strong>{i.film}</strong>
        <span>{i.soon ? "Tickets soon" : i.adult ? "Verified adults" : `$${i.price.value}${i.dubs ? ` · ${i.dubs} dubs` : ""}`}</span>
      </Link>
    );
  }

  return (
    <section className="hm-section hm-cal" id="calendar">
      <div className="hm-cal-head">
        <div className="lp-titles">
          <p className="lp-eyebrow">RELEASE CALENDAR</p>
          <h2 className="hm-h2">What&apos;s premiering</h2>
          <p className="hm-sub">Every screening happens once, at the same moment for everyone. Times are shown in your time zone.</p>
        </div>
        <div className="hm-cal-tools">
          <div className="hm-seg" role="group" aria-label="View">
            <button type="button" className={view === "week" ? "on" : ""} onClick={() => setView("week")}>Week</button>
            <Link href="/releases">Month</Link>
            <button type="button" className={view === "list" ? "on" : ""} onClick={() => setView("list")}>List</button>
          </div>
          <button type="button" className="lp-btn sm secondary" disabled={!nextUp} onClick={() => {
            if (!nextUp || now === null) return;
            setOffset(Math.floor((dayStart(Date.parse(nextUp.startsAt)) - dayStart(now)) / (7 * 86_400_000)));
            document.getElementById(`d-${dayStart(Date.parse(nextUp.startsAt))}`)?.scrollIntoView({ inline: "center", block: "nearest", behavior: "smooth" });
          }}>Next premiere</button>
        </div>
      </div>
      <div className="lp-chips" role="group" aria-label="Genres">
        {["All", ...GENRES.map((g) => g.id)].filter((g) => counts[g]).map((g) => (
          <button key={g} type="button" className={`lp-chip${g === genre ? " on" : ""}`} aria-pressed={g === genre} onClick={() => setGenre(g)}>
            {g === "K-Drama" ? "K-drama" : g}<em>{counts[g]}</em>
          </button>
        ))}
      </div>
      {view === "week" ? (
        <>
          <div className="hm-week">
            {days.map((d) => {
              const today = now !== null && d === dayStart(now);
              const list = shown.filter((i) => dayStart(Date.parse(i.startsAt)) === d);
              const label = new Date(d);
              return (
                <div key={d} id={`d-${d}`} className={`hm-day${today ? " today" : ""}`}>
                  <div className="hm-day-head">
                    <span>{label.toLocaleDateString([], { weekday: "short" }).toUpperCase()}</span>
                    <b>{label.getDate()} {label.toLocaleDateString([], { month: "short" }).toUpperCase()}</b>
                    {today && <span className="lp-badge pro">TODAY</span>}
                  </div>
                  {list.map(card)}
                  {list.length === 0 && <p className="hm-empty">No premieres. Ask AI to remind you when one is added.</p>}
                </div>
              );
            })}
          </div>
          <div className="hm-week-nav">
            <button type="button" className="lp-btn sm ghost" disabled={offset <= 0} onClick={() => setOffset((o) => o - 1)}>← This week</button>
            <button type="button" className="lp-btn sm ghost" onClick={() => setOffset((o) => o + 1)}>Next week →</button>
          </div>
        </>
      ) : (
        <div className="hm-list">{shown.map(card)}</div>
      )}
      <div className="hm-cal-foot">
        <Link href="/releases">Open the full calendar →</Link>
        <span>Tap any premiere to book it, or ask AI to book it for you.</span>
      </div>
    </section>
  );
}
