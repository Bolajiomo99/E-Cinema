import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { endsAt, showtimes, type Showtime } from "@/lib/catalog";
import { TYPES, typeOf, type TypeId } from "@/lib/browse";
import { LANGS } from "@/lib/i18n";

// Search (Figma 30:750): plain-language queries like "anime about friendship, dubbed in Hausa,
// this weekend". Claude reads the query against the live catalogue; a rule-based parser does the
// same job when the AI is unavailable, so search always answers.
export type Filters = { types: TypeId[]; audio?: string; from?: number; to?: number; maxPrice?: number; theme?: string; when?: string };
export type Hit = { id: string; why: string };
export type SearchResult = { understood: string[]; filters: Filters; hits: Hit[]; ai: boolean };

const DAY = 86_400_000;
const startOfDay = (t: number) => { const d = new Date(t); d.setUTCHours(0, 0, 0, 0); return d.getTime(); };

function whenRange(q: string, now: number): { from?: number; to?: number; label?: string } {
  const today = startOfDay(now);
  if (/\b(tonight|today)\b/.test(q)) return { from: now, to: today + DAY, label: "Today" };
  if (/\btomorrow\b/.test(q)) return { from: today + DAY, to: today + 2 * DAY, label: "Tomorrow" };
  if (/\bweekend\b/.test(q)) {
    const dow = new Date(today).getUTCDay(); // 0 Sun .. 6 Sat
    const start = today + (dow === 0 ? -2 : dow === 6 ? -1 : 5 - dow) * DAY; // that weekend's Friday
    return { from: Math.max(now, start), to: start + 3 * DAY, label: "This weekend" };
  }
  if (/\bnext week\b/.test(q)) return { from: now + 7 * DAY, to: now + 14 * DAY, label: "Next week" };
  if (/\bthis week\b/.test(q)) return { from: now, to: now + 7 * DAY, label: "This week" };
  return {};
}

const LANG_WORDS: [RegExp, string][] = [
  [/\byoru?ba\b|yorùbá/, "Yorùbá"], [/\bhausa\b/, "Hausa"], [/\bigbo\b/, "Igbo"], [/\bfrench\b|français/, "Français"], [/\bhindi\b/, "हिन्दी"],
  [/\bkorean\b/, "한국어"], [/\bspanish\b|español/, "Español"], [/\bportuguese\b/, "Português"], [/\bgerman\b/, "Deutsch"], [/\barabic\b/, "العربية"], [/\bswahili\b/, "Kiswahili"], [/\benglish\b/, "English"],
];

export function ruleParse(raw: string, now = Date.now()): Filters {
  const q = raw.toLowerCase();
  const types = TYPES.filter((t) => q.includes(t.label.toLowerCase()) || q.includes(t.id.replace("-", " ")) || (t.id === "movies" && /\b(movie|film)s?\b/.test(q))).map((t) => t.id as TypeId);
  const audio = LANG_WORDS.find(([re]) => re.test(q))?.[1];
  const w = whenRange(q, now);
  const price = q.match(/under\s*\$?\s*(\d+(?:\.\d+)?)/);
  const theme = q.match(/\babout\s+([a-z\s]+?)(?:,|$| dubbed| this| next| tonight| under)/)?.[1]?.trim();
  return { types, audio, from: w.from, to: w.to, when: w.label, maxPrice: price ? Number(price[1]) : undefined, theme };
}

function apply(f: Filters, now: number): Showtime[] {
  return showtimes.filter((s) => {
    if (endsAt(s) <= now) return false;
    const t = Date.parse(s.startsAt);
    if (f.from && endsAt(s) < f.from) return false;
    if (f.to && t >= f.to) return false;
    if (f.types.length && !f.types.includes(typeOf(s))) return false;
    if (f.maxPrice !== undefined && Number(s.price.value) > f.maxPrice) return false;
    return true;
  });
}

const words = (s: string) => s.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2);
function textScore(s: Showtime, q: string) {
  const hay = `${s.film} ${s.studio} ${(s.genres ?? []).join(" ")} ${s.category ?? ""} ${s.language ?? ""} ${s.blurb ?? ""}`.toLowerCase();
  return words(q).reduce((n, w) => n + (hay.includes(w) ? (s.film.toLowerCase().includes(w) ? 3 : 1) : 0), 0);
}

export function understoodOf(f: Filters): string[] {
  const out: string[] = [];
  if (f.types.length) out.push(f.types.map((t) => TYPES.find((x) => x.id === t)!.label).join(", "));
  if (f.theme) out.push(`Theme: ${f.theme}`);
  if (f.audio) out.push(`Audio: ${f.audio}`);
  if (f.when) out.push(f.when);
  if (f.maxPrice !== undefined) out.push(`Under $${f.maxPrice}`);
  return out;
}

function ruleSearch(q: string, now: number): SearchResult {
  const f = ruleParse(q, now);
  const structured = f.types.length || f.when || f.maxPrice !== undefined;
  let list = apply(f, now).map((s) => ({ s, score: textScore(s, q) }));
  if (!structured) list = list.filter((x) => x.score > 0);
  list.sort((a, b) => b.score - a.score || Date.parse(a.s.startsAt) - Date.parse(b.s.startsAt));
  const hits = list.slice(0, 12).map(({ s }) => ({ id: s.id, why: `${(s.genres ?? []).join(", ")} from ${s.studio}.${f.audio ? ` ${f.audio.replace(/ .*/, "")} dub ready.` : ""}` }));
  return { understood: understoodOf(f), filters: f, hits, ai: false };
}

let client: Anthropic | undefined;
const cache = new Map<string, { at: number; r: SearchResult }>();

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["types", "audio", "theme", "when", "maxPrice", "results"],
  properties: {
    types: { type: "array", items: { type: "string", enum: TYPES.map((t) => t.id) } },
    audio: { type: "string", description: "Language the viewer wants to hear, or empty" },
    theme: { type: "string", description: "Story theme or mood asked for, or empty" },
    when: { type: "string", enum: ["", "today", "tomorrow", "weekend", "this week", "next week"] },
    maxPrice: { type: "number", description: "Highest seat price in USD, or 0 for no limit" },
    results: {
      type: "array",
      items: { type: "object", additionalProperties: false, required: ["id", "why"], properties: { id: { type: "string" }, why: { type: "string", description: "One short line, under 70 characters, on why it fits. Only facts from the catalogue." } } },
    },
  },
} as const;

export async function search(raw: string, now = Date.now()): Promise<SearchResult> {
  const q = raw.trim().slice(0, 200);
  if (!q) return { understood: [], filters: { types: [] }, hits: [], ai: false };
  const key = q.toLowerCase();
  const hit = cache.get(key);
  if (hit && now - hit.at < 10 * 60_000) return hit.r;
  if (!process.env.ANTHROPIC_API_KEY) return ruleSearch(q, now);

  const open = showtimes.filter((s) => endsAt(s) > now);
  const catalogue = open.map((s) => ({ id: s.id, title: s.film, studio: s.studio, format: typeOf(s), genres: s.genres, startsAtUTC: s.startsAt, priceUSD: s.price.value, rating: s.rating, originalAudio: s.language, aiDubTracks: s.dubs, blurb: s.blurb }));
  try {
    client ??= new Anthropic();
    const res = await client.messages.create({
      model: "claude-opus-5-5",
      max_tokens: 2000,
      output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA } },
      system: `You are the search engine of E-Cinema, a cinema that premieres each film once, live, worldwide. Read the viewer's query, extract filters, and rank only titles from the catalogue that fit. Every title can be dubbed by AI into ${LANGS.map(([, n]) => n).join(", ")}, so an audio request never excludes a title; mention "<language> dub ready" in why when asked. Never invent titles, cast or facts. If nothing fits, return an empty results list. The current time is ${new Date(now).toISOString()}.\n\nCatalogue:\n${JSON.stringify(catalogue)}`,
      messages: [{ role: "user", content: q }],
    }, { timeout: 15_000, maxRetries: 1 });
    if (res.stop_reason === "refusal") return ruleSearch(q, now);
    const text = res.content.find((b) => b.type === "text");
    if (!text || text.type !== "text") return ruleSearch(q, now);
    const out = JSON.parse(text.text) as { types: TypeId[]; audio: string; theme: string; when: string; maxPrice: number; results: Hit[] };
    const ids = new Set(open.map((s) => s.id));
    const w = out.when ? whenRange(out.when, now) : {};
    const filters: Filters = { types: out.types, audio: out.audio || undefined, theme: out.theme || undefined, when: w.label, from: w.from, to: w.to, maxPrice: out.maxPrice > 0 ? out.maxPrice : undefined };
    const r: SearchResult = { understood: understoodOf(filters), filters, hits: out.results.filter((h) => ids.has(h.id)).slice(0, 12).map((h) => ({ id: h.id, why: h.why.slice(0, 120) })), ai: true };
    cache.set(key, { at: now, r });
    if (cache.size > 500) cache.delete(cache.keys().next().value!);
    return r;
  } catch (err) {
    console.error("search: AI unavailable, using rules", err instanceof Error ? err.message : err);
    return ruleSearch(q, now);
  }
}
