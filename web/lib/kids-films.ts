import { endsAt, showtimes, type Showtime, nextPerFilm } from "@/lib/catalog";

// Films for the kids cinema: family and animation titles, never 18+, not yet over.
export function kidsFilms(now = Date.now()): Showtime[] {
  return nextPerFilm(showtimes.filter((s) => !s.adult && (s.category === "Cartoon" || s.genres?.includes("Family")) && endsAt(s) > now));
}

export function whenText(list: Showtime[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const s of list) {
    const parts = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Africa/Lagos", hour12: false }).formatToParts(new Date(s.startsAt));
    const g = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
    out[s.id] = `${g("weekday")} ${g("day")} ${g("month")} · ${g("hour")}:${g("minute")}`;
  }
  return out;
}
