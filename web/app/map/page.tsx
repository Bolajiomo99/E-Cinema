import Logo from "@/components/landing/Logo";
import WorldMap, { type MapFilm } from "@/components/map/WorldMap";
import { liveStats, seatsFor, tonightAudience } from "@/lib/api";
import { endsAt, showtimes, nextPerFilm } from "@/lib/catalog";
import { readLocale } from "@/lib/locale";

// Built from the Figma frame "Web / World map · live" (32:1201), with live room numbers.
export const dynamic = "force-dynamic";
export const metadata = { title: "World map · E-Cinema", description: "Where the world is watching right now, by country." };

export default async function MapPage() {
  const now = Date.now();
  const [live, tonight, loc] = await Promise.all([liveStats(), tonightAudience(), readLocale()]);
  const open = nextPerFilm(showtimes.filter((s) => endsAt(s) > now));
  // Seats left only for the first few upcoming screenings the strip can show.
  const upcoming = open.filter((s) => Date.parse(s.startsAt) > now).slice(0, 4);
  const seats = new Map(await Promise.all(upcoming.map(async (s) => [s.id, await seatsFor(s.id)] as const)));
  const films: MapFilm[] = open.map((s) => ({
    id: s.id, film: s.film, language: s.language, startsAt: s.startsAt, endsAt: endsAt(s), poster: s.poster,
    seatsLeft: seats.get(s.id)?.available,
  }));
  return (
    <div className="lp wmp">
      <header className="wm-top">
        <Logo />
      </header>
      <WorldMap films={films} initialLive={live} initialTonight={tonight} home={loc.country ?? undefined} />
      <p className="wm-note">
        <svg viewBox="0 0 14 14" aria-hidden><circle cx="7" cy="7" r="6" /><path d="M7 6v4M7 4v.5" /></svg>
        Country-level only, from each viewer&apos;s profile. Nobody&apos;s location is shown.
      </p>
    </div>
  );
}
