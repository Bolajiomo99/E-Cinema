import { session } from "@/lib/licensing";
import { execContent, execMe } from "@/lib/exec";
import { findShowtime } from "@/lib/catalog";
import ExecContent from "@/components/exec/ExecContent";

export const metadata = { title: "Content and studios · Executive · E-Cinema", robots: { index: false } };

function nowMs() {
  return Date.now();
}

// Content and studios (Figma 82:633): the platform view of every film and studio.
export default async function ContentPage() {
  const s = await session();
  const [c, me] = await Promise.all([execContent(s), execMe(s)]);
  if (!c) return <section className="exc"><h1>Content and studios</h1><p className="exc-sub">This page is for the CEO, the COO and the CMO.</p></section>;
  // The film's type: the studio's own genres, or the catalog's category for launch titles.
  const films = c.films.map((f) => ({ ...f, type: f.genres.split(",")[0]?.trim() || (f.showtime ? findShowtime(f.showtime)?.category ?? findShowtime(f.showtime)?.genres?.[0] : "") || "" }));
  return <ExecContent c={{ ...c, films }} canApprove={me?.role === "ceo" || me?.role === "coo"} now={nowMs()} />;
}
