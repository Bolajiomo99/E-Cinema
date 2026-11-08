import StudioFilms, { type FilmRow } from "@/components/studio/StudioFilms";
import { findShowtime } from "@/lib/catalog";
import { session } from "@/lib/licensing";
import { dubLanguages, mediaEnabled } from "@/lib/media";
import { studioPage } from "@/lib/studio";
import { ago, type Film, type Upload } from "@/lib/studio-types";

// Figma "Studio / Films" (34:458).
export const metadata = { title: "Films · Studio · E-Cinema", robots: { index: false } };

function kind(f: Film) {
  const c = findShowtime(f.showtimeId);
  const mins = c?.runtimeMin ?? f.durationMin;
  const len = mins ? `${Math.floor(mins / 60)}h ${String(mins % 60).padStart(2, "0")}m` : "";
  const what = c?.episodes ? "Series" : c?.category === "Anime" ? "Anime" : "Movie";
  return [what, c?.genres?.[0], len].filter(Boolean).join(" · ");
}

export default async function StudioFilmsPage() {
  const s = await session();
  const [r, up] = await Promise.all([studioPage<{ films: Film[] }>(s, "films"), studioPage<{ uploads: Upload[] }>(s, "uploads")]);
  const now = new Date().getTime();
  // One row per film: its weekly and sell-out encores fold into the premiere they repeat.
  const byOrigin = new Map<string, Film[]>();
  for (const f of r?.films ?? []) {
    const k = f.origin || f.showtimeId;
    byOrigin.set(k, [...(byOrigin.get(k) ?? []), f]);
  }
  const films: FilmRow[] = [...byOrigin.entries()].map(([origin, all]) => {
    const first = all.find((f) => f.showtimeId === origin) ?? all[all.length - 1];
    const live = all.find((f) => f.state === "live");
    const next = all.filter((f) => f.state === "upcoming").sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt))[0];
    const state: Film["state"] = live ? "live" : next ? "upcoming" : "ended";
    return {
      ...first, state, startsAt: (live ?? next ?? first).startsAt,
      seats: all.reduce((n, f) => n + f.seats, 0), grossCents: all.reduce((n, f) => n + f.grossCents, 0),
      shareCents: all.reduce((n, f) => n + f.shareCents, 0),
      payout: all.every((f) => f.payout === "sent") ? "sent" : first.payout,
      kind: kind(first), dubs: 0,
      screenings: all.length, upcoming: all.filter((f) => f.state === "upcoming").length,
    };
  }).sort((a, b) => Date.parse(b.startsAt) - Date.parse(a.startsAt));
  // Languages counts the AI dub tracks this film really has in storage, not the catalog's plan.
  if (mediaEnabled) await Promise.all(films.map(async (f) => { f.dubs = (await dubLanguages(f.showtimeId).catch(() => [])).length; }));
  const drafts = (up?.uploads ?? []).filter((u) => u.status === "draft").map((u) => ({ id: u.id, title: u.title, files: u.files.length, saved: ago(u.updatedAt, now) }));
  return <StudioFilms films={films} drafts={drafts} now={now} />;
}
