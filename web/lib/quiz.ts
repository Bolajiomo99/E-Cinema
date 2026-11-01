import "server-only";
import { showtimes, type Showtime } from "@/lib/catalog";

// Pre-show quiz (Figma 30:989). Every question comes from facts in the catalogue, so answers are never invented.
export type Question = { q: string; options: string[]; answer: number };

// A small seeded shuffle so a premiere's quiz is the same for everyone and on every reload.
function seeded(seed: string) {
  let h = 2166136261;
  for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  // mulberry32: the state steps by a constant, so it never gets stuck.
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function pick<T>(rnd: () => number, right: T, pool: T[]): { options: T[]; answer: number } {
  const others = [...new Set(pool.filter((x) => x !== right))].sort(() => rnd() - 0.5).slice(0, 3);
  const options = [...others];
  const answer = Math.floor(rnd() * (options.length + 1));
  options.splice(answer, 0, right);
  return { options, answer };
}
const hm = (m: number) => `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;

export function quizFor(s: Showtime): Question[] {
  const rnd = seeded(s.id);
  const out: Question[] = [];
  const add = (q: string, right: string | undefined, pool: (string | undefined)[]) => {
    if (!right) return;
    const p = pick(rnd, right, pool.filter((x): x is string => Boolean(x)));
    if (p.options.length === 4) out.push({ q, ...p });
  };
  add(`Which studio made ${s.film}?`, s.studio, showtimes.map((x) => x.studio));
  add(`What language was ${s.film} first made in?`, s.language, ["English", "French", "Hausa", "Hindi", "Japanese", "Korean", "Yoruba", "Igbo", "Swahili", "Spanish"]);
  add(`Which of these genres fits ${s.film}?`, s.genres?.[0], ["Drama", "Thriller", "Romance", "Sci-fi", "Comedy", "Animation", "Horror", "Musical", "Action", "Documentary"].filter((g) => !s.genres?.includes(g) || g === s.genres?.[0]));
  if (s.runtimeMin) add(`How long does ${s.film} run?`, hm(s.runtimeMin), [s.runtimeMin - 17, s.runtimeMin + 14, s.runtimeMin - 31, s.runtimeMin + 26].map(hm));
  if (s.dubs) add(`How many AI dub tracks are ready for ${s.film} tonight?`, String(s.dubs), [s.dubs - 9, s.dubs + 6, s.dubs - 4, s.dubs + 12].filter((n) => n > 0).map(String));
  if (s.category) add(`Which film world does ${s.film} come from?`, s.category, ["Nollywood", "Bollywood", "Hollywood", "K-Drama", "Anime", "Cartoon"]);
  if (s.rating) add(`What is ${s.film} rated?`, s.rating, ["G", "PG", "PG-13", "15", "18+"]);
  return out.slice(0, 5);
}

// The prize: one HD seat's worth of credit, at this premiere's seat price.
export const quizPrize = (s: Showtime) => (s.price.currency === "USD" ? Math.round(Number(s.price.value) * 100) : 0);
