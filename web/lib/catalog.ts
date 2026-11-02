// Showtimes and prices live on the server so a browser can never change what it pays.
export type Showtime = {
  id: string;
  film: string;
  studio: string;
  startsAt: string; // ISO time
  price: { currency: string; value: string };
  shopQuery: string; // what "Shop the film" searches for
  year?: number;
  genres?: string[];
  runtimeMin?: number;
  rating?: string; // e.g. PG-13, 18+
  adult?: boolean; // only face- and ID-verified viewers can book
  category?: "Nollywood" | "Bollywood" | "Hollywood" | "K-Drama" | "Anime" | "Cartoon";
  earlySave?: number; // pre-order: the most a seat bought early saves, in percent
  vr?: boolean; // VR ready
  episodes?: number; // a series premiere
  format?: string; // e.g. "4K HDR · Dolby Atmos"
  language?: string; // original audio
  dubs?: number; // AI dub tracks offered
  featured?: boolean; // leads the landing page hero
  blurb?: string;
  poster?: { from: string; via: string; to: string; glow: string };
  posterImage?: string; // a studio's uploaded poster
  studioFilm?: string; // set on premieres a studio published from its portal
  local?: Record<string, { currency: string; minor: number }>; // studio's price per country
};

const blue = "rgba(70,150,255,.45)", amber = "rgba(255,140,40,.45)", red = "rgba(227,24,45,.45)";

// Mirrors the showtimes table in the API (migrations 001 and 008), in start order.
export const showtimes: Showtime[] = [
  { id: "tide-of-lagos-2026-11-01", film: "Tide of Lagos", studio: "Lagoon Gate Pictures", startsAt: "2026-11-01T16:00:00Z", price: { currency: "USD", value: "4.99" }, shopQuery: "lagos beach towel",
    year: 2026, genres: ["Drama"], runtimeMin: 112, rating: "PG-13", category: "Nollywood", language: "Yoruba", dubs: 26, poster: { from: "#0c2a3a", via: "#06121a", to: "#000", glow: blue } },
  { id: "monsoon-hearts-2026-11-01", film: "Monsoon Hearts", studio: "Saffron Reel Studios", startsAt: "2026-11-01T19:00:00Z", price: { currency: "USD", value: "4.99" }, shopQuery: "monsoon rain umbrella",
    year: 2026, genres: ["Romance", "Musical"], runtimeMin: 146, rating: "PG", category: "Bollywood", language: "Hindi", dubs: 31, poster: { from: "#3b2a0a", via: "#160f04", to: "#000", glow: amber } },
  { id: "the-last-harmattan-2026-11-01", film: "The Last Harmattan", studio: "Sahel Lantern Films", startsAt: "2026-11-01T19:30:00Z", price: { currency: "USD", value: "5.99" }, shopQuery: "harmattan desert scarf",
    year: 2026, genres: ["Drama", "Thriller"], runtimeMin: 131, rating: "PG-13", category: "Nollywood", language: "Hausa", dubs: 42, featured: true,
    blurb: "One night, one screening, the whole world in the same seat. Hear it in Yoruba, Hausa, Hindi, French or 38 other languages, and talk to the person watching in Lagos, Mumbai or Lyon.",
    poster: { from: "#2a070c", via: "#12060a", to: "#050507", glow: amber } },
  { id: "orbit-zero-2026-11-01", film: "Orbit Zero", studio: "Northlight Pictures", startsAt: "2026-11-01T21:30:00Z", price: { currency: "USD", value: "6.99" }, shopQuery: "astronaut graphic tee",
    year: 2026, genres: ["Sci-fi"], runtimeMin: 124, rating: "PG-13", category: "Hollywood", language: "English", dubs: 42, poster: { from: "#1d1440", via: "#0b0819", to: "#000", glow: red } },
  { id: "the-kano-ledger-2026-11-02", film: "The Kano Ledger", studio: "Arewa Frame House", startsAt: "2026-11-02T18:00:00Z", price: { currency: "USD", value: "4.49" }, shopQuery: "leather notebook",
    year: 2026, genres: ["Crime", "Drama"], runtimeMin: 109, rating: "PG-13", category: "Nollywood", language: "Hausa", dubs: 18, poster: { from: "#0f3324", via: "#06140e", to: "#000", glow: amber } },
  { id: "red-earth-2026-11-02", film: "Red Earth", studio: "Lagoon Gate Pictures", startsAt: "2026-11-02T19:00:00Z", price: { currency: "USD", value: "6.99" }, shopQuery: "red ankara print shirt",
    year: 2026, genres: ["Drama"], runtimeMin: 118, rating: "PG-13", category: "Nollywood", language: "English", dubs: 3, poster: { from: "#3a0f0a", via: "#170605", to: "#000", glow: red } },
  { id: "velvet-hour-2026-11-02", film: "Velvet Hour", studio: "Maison Velours", startsAt: "2026-11-02T22:00:00Z", price: { currency: "USD", value: "7.99" }, shopQuery: "velvet cushion",
    year: 2026, genres: ["Romance"], runtimeMin: 98, rating: "18+", adult: true, language: "French", dubs: 22, poster: { from: "#40161f", via: "#1a0a10", to: "#050203", glow: red } },
  { id: "seoul-after-rain-2026-11-03", film: "Seoul After Rain", studio: "Hanbit Story House", startsAt: "2026-11-03T13:00:00Z", price: { currency: "USD", value: "5.49" }, shopQuery: "clear rain umbrella",
    year: 2026, genres: ["Drama", "Romance"], runtimeMin: 104, rating: "PG", category: "K-Drama", language: "Korean", dubs: 3, poster: { from: "#14233a", via: "#070d18", to: "#000", glow: blue } },
  { id: "lagos-lights-2026-11-04", film: "Lagos Lights", studio: "Lagoon Gate Pictures", startsAt: "2026-11-04T20:00:00Z", price: { currency: "USD", value: "6.99" }, shopQuery: "neon city graphic tee",
    year: 2026, genres: ["Comedy"], runtimeMin: 126, rating: "PG-13", category: "Nollywood", language: "English", dubs: 3, poster: { from: "#2e0a2c", via: "#120411", to: "#000", glow: red } },
  // Coming soon (Figma 52:808): bookable now at the pre-order price.
  { id: "moonlight-fox-2026-11-07", film: "Moonlight Fox", studio: "Baobab Kids Studio", startsAt: "2026-11-07T14:00:00Z", price: { currency: "USD", value: "2.99" }, shopQuery: "fox plush toy",
    year: 2026, genres: ["Family", "Animation"], runtimeMin: 84, rating: "G", category: "Cartoon", language: "English", dubs: 29, vr: true,
    blurb: "A little fox follows the moon across the savanna to find her way home.", poster: { from: "#1d1440", via: "#0b0819", to: "#000", glow: "rgba(139,124,246,.5)" } },
  { id: "kofi-and-the-drum-2026-11-14", film: "Kofi and the Drum", studio: "Baobab Kids Studio", startsAt: "2026-11-14T14:00:00Z", price: { currency: "USD", value: "2.99" }, shopQuery: "kids talking drum",
    year: 2026, genres: ["Family", "Musical"], runtimeMin: 78, rating: "G", category: "Cartoon", language: "Yoruba", dubs: 29,
    blurb: "Kofi's grandfather's drum can wake the whole village, if he learns to play it.", poster: { from: "#3b2a0a", via: "#160f04", to: "#000", glow: amber } },
  { id: "neon-shrine-2026-11-21", film: "Neon Shrine", studio: "Kumo Animation", startsAt: "2026-11-21T18:00:00Z", price: { currency: "USD", value: "5.99" }, shopQuery: "anime shrine poster",
    year: 2026, genres: ["Fantasy"], runtimeMin: 108, rating: "PG", category: "Anime", language: "Japanese", dubs: 34, earlySave: 35, vr: true, format: "4K HDR",
    poster: { from: "#1d1440", via: "#0b0819", to: "#000", glow: "rgba(230,40,90,.55)" } },
  { id: "starship-mama-2026-11-28", film: "Starship Mama", studio: "Starlight Kids", startsAt: "2026-11-28T15:00:00Z", price: { currency: "USD", value: "2.99" }, shopQuery: "kids rocket toy",
    year: 2026, genres: ["Family", "Sci-fi"], runtimeMin: 88, rating: "PG", category: "Cartoon", language: "English", dubs: 29, vr: true,
    blurb: "Mama flies the family starship; the kids have to land it.", poster: { from: "#083331", via: "#041413", to: "#000", glow: "rgba(40,200,180,.5)" } },
  { id: "iron-delta-2026-12-14", film: "Iron Delta", studio: "Starlight Pictures", startsAt: "2026-12-14T19:00:00Z", price: { currency: "USD", value: "7.99" }, shopQuery: "tactical jacket",
    year: 2026, genres: ["Thriller"], runtimeMin: 130, rating: "PG-13", category: "Hollywood", language: "English", dubs: 42, earlySave: 38, vr: true, format: "4K HDR · Dolby Atmos",
    blurb: "A river delta, a stolen shipment and one night to get it back.", poster: { from: "#2b2e36", via: "#121318", to: "#000", glow: red } },
  { id: "winter-in-busan-2027-01-02", film: "Winter in Busan", studio: "Hanbit Story House", startsAt: "2027-01-02T12:00:00Z", price: { currency: "USD", value: "5.49" }, shopQuery: "knit winter scarf",
    year: 2027, genres: ["Romance", "Drama"], runtimeMin: 70, rating: "PG", category: "K-Drama", language: "Korean", dubs: 28, earlySave: 40, vr: true, episodes: 12,
    poster: { from: "#0c2a3a", via: "#06121a", to: "#000", glow: blue } },
  { id: "the-last-durbar-2027-03-27", film: "The Last Durbar", studio: "Sahel Lantern Films", startsAt: "2027-03-27T18:00:00Z", price: { currency: "USD", value: "6.99" }, shopQuery: "durbar horse figurine",
    year: 2027, genres: ["Epic", "History"], runtimeMin: 152, rating: "PG-13", category: "Nollywood", language: "Hausa", dubs: 40, earlySave: 45, vr: true, format: "4K HDR · Dolby Atmos",
    poster: { from: "#3b2a0a", via: "#160f04", to: "#000", glow: amber } },
  { id: "little-orbit-2-2027-10-30", film: "Little Orbit 2", studio: "Starlight Kids", startsAt: "2027-10-30T15:00:00Z", price: { currency: "USD", value: "4.99" }, shopQuery: "kids rocket toy",
    year: 2027, genres: ["Family", "Animation"], runtimeMin: 92, rating: "G", category: "Cartoon", language: "English", dubs: 38, earlySave: 50, vr: true,
    poster: { from: "#083331", via: "#041413", to: "#000", glow: "rgba(40,200,180,.5)" } },
];

export const endsAt = (s: Showtime) => Date.parse(s.startsAt) + (s.runtimeMin ?? 120) * 60_000;

// Premieres studios publish from the portal (Figma 35:514) join the list on the server, kept
// fresh by lib/live-catalog.ts. Client bundles only carry the fixed lineup above.
export function mergeLive(list: Showtime[]) {
  const fixed = showtimes.filter((s) => !s.studioFilm);
  const ids = new Set(fixed.map((s) => s.id));
  const next = [...fixed, ...list.filter((s) => !ids.has(s.id))].sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
  showtimes.splice(0, showtimes.length, ...next);
}

export function findShowtime(id: string): Showtime | undefined {
  return showtimes.find((s) => s.id === id);
}

// "Shop the film" tabs (Figma 283:1332): what each tab searches for, by the film's world.
export type ShopTab = "scene" | "outfits" | "gifts" | "snacks";
const SHOP_BY_CATEGORY: Record<string, Omit<Record<ShopTab, string>, "scene">> = {
  Nollywood: { outfits: "ankara print outfit", gifts: "african print gift", snacks: "chin chin plantain chips snack box" },
  Bollywood: { outfits: "kurta outfit", gifts: "indian brass gift", snacks: "indian namkeen snack box" },
  Hollywood: { outfits: "movie graphic tee", gifts: "movie lover gift", snacks: "gourmet popcorn gift box" },
  "K-Drama": { outfits: "korean street fashion outfit", gifts: "korean skincare gift set", snacks: "korean snack box" },
  Anime: { outfits: "anime hoodie", gifts: "anime figure", snacks: "japanese snack box" },
  Cartoon: { outfits: "kids pajamas set", gifts: "kids space toy", snacks: "kids snack box" },
};
export function shopQuery(s: Showtime, tab: ShopTab): string {
  if (tab === "scene") return s.shopQuery;
  return (SHOP_BY_CATEGORY[s.category ?? ""] ?? { outfits: `${s.genres?.[0] ?? "movie"} inspired outfit`, gifts: "movie night gift", snacks: "movie night snack box" })[tab];
}
