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
  category?: "Nollywood" | "Bollywood" | "Hollywood" | "K-Drama";
  language?: string; // original audio
  dubs?: number; // AI dub tracks offered
  featured?: boolean; // leads the landing page hero
  blurb?: string;
  poster?: { from: string; via: string; to: string; glow: string };
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
];

export const endsAt = (s: Showtime) => Date.parse(s.startsAt) + (s.runtimeMin ?? 120) * 60_000;

export function findShowtime(id: string): Showtime | undefined {
  return showtimes.find((s) => s.id === id);
}
