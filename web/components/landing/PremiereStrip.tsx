"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { Showtime } from "@/lib/catalog";

type Tile = Showtime & { endsAtMs: number };
const FILTERS = ["All", "Tonight", "Tomorrow", "Nollywood", "Bollywood", "Hollywood", "K-Drama"] as const;
type Filter = (typeof FILTERS)[number];

const dayKey = (ms: number) => new Date(ms).toDateString();
const hhmm = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });

// Badge text in the viewer's own time zone: LIVE NOW, TONIGHT 20:00, TOMORROW 19:00 or a date.
function badge(t: Tile, now: number): { text: string; kind: "live" | "light" | "outline" | "adult" } {
  const start = Date.parse(t.startsAt);
  if (t.adult) return { text: "18+", kind: "adult" };
  if (now >= start && now < t.endsAtMs) return { text: "LIVE NOW", kind: "live" };
  if (dayKey(start) === dayKey(now)) return { text: `TONIGHT ${hhmm(start)}`, kind: "light" };
  if (dayKey(start) === dayKey(now + 86_400_000)) return { text: `TOMORROW ${hhmm(start)}`, kind: "outline" };
  const d = new Date(start).toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" }).toUpperCase();
  return { text: `${d} ${hhmm(start)}`, kind: "outline" };
}

function matches(f: Filter, t: Tile, now: number) {
  const start = Date.parse(t.startsAt);
  if (f === "All") return true;
  if (f === "Tonight") return dayKey(start) === dayKey(now) || (now >= start && now < t.endsAtMs);
  if (f === "Tomorrow") return dayKey(start) === dayKey(now + 86_400_000);
  return t.category === f;
}

export default function PremiereStrip({ tiles, eyebrow = "THIS WEEK ONLY", title = "Premieres near your time zone" }: { tiles: Tile[]; eyebrow?: string; title?: string }) {
  const [now, setNow] = useState<number | null>(null);
  const [filter, setFilter] = useState<Filter>("All");
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const first = setTimeout(tick, 0);
    const t = setInterval(tick, 30_000);
    return () => { clearTimeout(first); clearInterval(t); };
  }, []);
  const shown = now === null ? tiles : tiles.filter((t) => matches(filter, t, now));

  return (
    <>
      <div className="lp-head">
        <div className="lp-titles">
          <p className="lp-eyebrow">{eyebrow}</p>
          <h2>{title}</h2>
        </div>
        <div className="lp-chips" role="group" aria-label="Filter premieres">
          {FILTERS.map((f) => (
            <button key={f} type="button" className={`lp-chip${f === filter ? " on" : ""}`} aria-pressed={f === filter} onClick={() => setFilter(f)}>{f}</button>
          ))}
          <Link href="/browse" className="lp-chip">See all</Link>
        </div>
      </div>
      <ul className="lp-strip">
        {shown.map((t) => {
          const b = now === null ? null : badge(t, now);
          const live = b?.kind === "live";
          const left = live && now !== null ? Math.max(1, Math.round((t.endsAtMs - now) / 60_000)) : 0;
          const [first, ...rest] = t.film.toUpperCase().split(" ");
          const title = rest.length && first.length <= 4 ? [`${first} ${rest[0]}`, rest.slice(1).join(" ")] : [first, rest.join(" ")];
          const p = t.poster ?? { from: "#1b1b21", via: "#0e0e12", to: "#000", glow: "rgba(227,24,45,.45)" };
          return (
            <li key={t.id} className="lp-tile">
              <Link href={live ? `/room/${t.id}` : `/film/${t.id}`} className="lp-poster" style={{ background: `linear-gradient(180deg, ${p.from} 0%, ${p.via} 60%, ${p.to} 100%)` }}>
                <span className="lp-poster-glow" style={{ background: p.glow }} aria-hidden />
                <span className="lp-poster-shade" aria-hidden />
                <span className="lp-poster-title">{title.filter(Boolean).map((l) => <span key={l}>{l}</span>)}</span>
                {b && <span className={`lp-badge ${b.kind}`}>{b.kind === "live" && <i />}{b.text}</span>}
              </Link>
              <div className="lp-tile-meta">
                <span>{live ? `Ends in ${left} min` : t.adult ? "Verified adults" : (t.priceLabel ?? `${t.price.currency === "USD" ? "$" : t.price.currency + " "}${t.price.value}`)}</span>
                <span>{t.language}{t.dubs ? ` · ${t.dubs} dubs` : ""}</span>
              </div>
            </li>
          );
        })}
        {shown.length === 0 && <li className="lp-empty">Nothing in this lineup yet. Try another filter.</li>}
      </ul>
    </>
  );
}
