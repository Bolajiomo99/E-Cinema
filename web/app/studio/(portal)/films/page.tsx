import StudioFilms, { type FilmRow } from "@/components/studio/StudioFilms";
import { findShowtime } from "@/lib/catalog";
import { session } from "@/lib/licensing";
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
  const films: FilmRow[] = (r?.films ?? []).map((f) => ({ ...f, kind: kind(f), dubs: findShowtime(f.showtimeId)?.dubs ?? 0 }));
  const now = new Date().getTime();
  const drafts = (up?.uploads ?? []).filter((u) => u.status === "draft").map((u) => ({ id: u.id, title: u.title, files: u.files.length, saved: ago(u.updatedAt, now) }));
  return <StudioFilms films={films} drafts={drafts} now={now} />;
}
