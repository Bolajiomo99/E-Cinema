import "server-only";
import { mergeLive, type Showtime } from "@/lib/catalog";
import { refreshPlatform } from "@/lib/platform";

// Studio premieres published from the portal (Figma 35:514), merged into the catalog every 30
// seconds so a published film shows up on the site and can be booked without a redeploy.
type LiveFilm = {
  showtimeId: string; upload: string; film: string; studio: string; startsAt: string; durationMin: number; priceCents: number; adult: boolean;
  logline: string; genres: string; ageRating: string; languages: string; poster: boolean; format: string;
  prices: Record<string, { country: string; currency: string; amountMinor: number }>;
  earlySave?: number; formats?: string[]; hasMaster?: boolean; blocked?: string[]; studioSlug?: string;
};

// How a coming-soon post's formats read on the film's card (Figma 53:1512).
const FORMAT_NAMES: Record<string, string> = { uhd: "4K HDR", atmos: "Dolby Atmos", "3d": "3D" };

const GLOWS = ["rgba(70,150,255,.45)", "rgba(255,140,40,.45)", "rgba(227,24,45,.45)"];
const TONES = [["#0c2a3a", "#06121a"], ["#3b2a0a", "#160f04"], ["#2a070c", "#12060a"], ["#1d1440", "#0b0819"], ["#0f3324", "#06140e"]];
const CATEGORIES = ["Nollywood", "Bollywood", "Hollywood", "K-Drama", "Anime", "Cartoon"] as const;

function hash(s: string) {
  let h = 0;
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) | 0;
  return Math.abs(h);
}

export function toShowtime(f: LiveFilm): Showtime {
  const genres = f.genres.split(",").map((g) => g.trim()).filter(Boolean);
  const h = hash(f.upload), tone = TONES[h % TONES.length];
  const fmt = f.format.split(" · ").slice(1, 3).join(" · ");
  const category = CATEGORIES.find((c) => genres.some((g) => g.toLowerCase() === c.toLowerCase()));
  return {
    id: f.showtimeId,
    film: f.film,
    studio: f.studio,
    startsAt: new Date(f.startsAt).toISOString(),
    price: { currency: "USD", value: (f.priceCents / 100).toFixed(2) },
    shopQuery: `${f.film} ${genres[0] ?? "movie"}`.toLowerCase(),
    year: new Date(f.startsAt).getUTCFullYear(),
    genres: genres.length ? genres : undefined,
    runtimeMin: f.durationMin,
    rating: f.ageRating.split(" (")[0] || undefined,
    adult: f.adult || undefined,
    category,
    format: /4K/.test(fmt) ? fmt : (f.formats ?? []).map((x) => FORMAT_NAMES[x]).filter(Boolean).join(" · ") || undefined,
    earlySave: f.earlySave || undefined,
    vr: (f.formats ?? []).includes("vr") || undefined,
    language: f.languages || undefined,
    blurb: f.logline || undefined,
    poster: { from: tone[0], via: tone[1], to: "#000", glow: GLOWS[h % GLOWS.length] },
    posterImage: f.poster ? `/api/films/${f.upload}/poster` : undefined,
    studioFilm: f.upload,
    blocked: f.blocked?.length ? f.blocked : undefined,
    studioSlug: f.studioSlug || undefined,
    local: Object.fromEntries(Object.values(f.prices ?? {}).map((p) => [p.country, { currency: p.currency, minor: p.amountMinor }])),
  };
}

let last = 0;
let lastLive: Showtime[] = [];
let running: Promise<void> | null = null;

export async function refreshLive(force = false) {
  void refreshPlatform(force);
  const base = process.env.API_URL, token = process.env.INTERNAL_API_TOKEN;
  if (!base || !token) { if (force) mergeLive([]); return; }
  if (!force && Date.now() - last < 30_000) return;
  if (running) return running;
  running = (async () => {
    try {
      const r = await fetch(`${base}/v1/studio-films`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(5000), cache: "no-store" });
      if (!r.ok) { mergeLive(lastLive); return; }
      const j = (await r.json()) as { films?: LiveFilm[] };
      lastLive = (j.films ?? []).map(toShowtime);
      mergeLive(lastLive);
      last = Date.now();
    } catch (e) {
      console.error("live catalog", e instanceof Error ? e.message : e);
      mergeLive(lastLive);
    } finally {
      running = null;
    }
  })();
  return running;
}

export function startLiveCatalog() {
  void refreshLive(true);
  setInterval(() => void refreshLive(true), 30_000).unref?.();
}
