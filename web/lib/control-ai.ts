import "server-only";
import Anthropic from "@anthropic-ai/sdk";

// "Audience mood" in the studio's live control room (Figma 37:1272). Claude reads the latest
// world-chat lines of the premiere and labels each one; the page charts the share that is
// positive over time. Readings are cached for two minutes per screening.

// countries: the positive share per country, for the control room's sentiment map; only countries
// with at least MIN_FELT lines that carry a feeling are shown, so one message never paints a country.
export type Mood = { positive: number; summary: string; points: { at: string; positive: number }[]; read: number; at: string; countries: Record<string, { positive: number; lines: number }> };
type Said = { body: string; at: string; country?: string };
const MIN_FELT = 3;

let client: Anthropic | null = null;
const cache = new Map<string, { at: number; mood: Mood }>();

export async function readMood(showtime: string, film: string, said: Said[]): Promise<Mood | null> {
  if (!process.env.ANTHROPIC_API_KEY || said.length < 5) return null;
  const hit = cache.get(showtime);
  if (hit && Date.now() - hit.at < 120_000) return hit.mood;
  client ??= new Anthropic();
  const lines = said.slice(-300);
  const res = await client.messages.create({
    model: "claude-sonnet-5-5",
    max_tokens: 4000,
    output_config: {
      effort: "low",
      format: {
        type: "json_schema",
        schema: {
          type: "object", additionalProperties: false, required: ["labels", "summary"],
          properties: {
            labels: { type: "string", description: "One letter per input line, in order: p for positive about the film or the moment, n for negative, x for neutral or unrelated" },
            summary: { type: "string", description: "Under 90 characters: what the audience is feeling and about which moment, from the chat only" },
          },
        },
      },
    },
    system: "You read the live chat of an online film premiere for the film's studio. Label each line's feeling about the film or what is on screen. Chat may be in any language. Base the summary only on what people wrote; never invent scenes or numbers.",
    messages: [{ role: "user", content: JSON.stringify({ film, lines: lines.map((l) => l.body) }) }],
  }, { timeout: 60_000, maxRetries: 1 });
  const t = res.content.find((b) => b.type === "text");
  if (res.stop_reason === "refusal" || !t || t.type !== "text") return null;
  const out = JSON.parse(t.text) as { labels: string; summary: string };
  const labels = out.labels.replace(/[^pnx]/g, "").slice(0, lines.length);
  // Ten points across the time the lines cover; each is the positive share of the lines with a feeling.
  const first = Date.parse(lines[0].at), last = Date.parse(lines[lines.length - 1].at);
  const span = Math.max(1, last - first), n = 10;
  const buckets = Array.from({ length: n }, () => ({ p: 0, f: 0 }));
  for (let i = 0; i < labels.length; i++) {
    const k = Math.min(n - 1, Math.floor(((Date.parse(lines[i].at) - first) / span) * n));
    if (labels[i] !== "x") { buckets[k].f++; if (labels[i] === "p") buckets[k].p++; }
  }
  const felt = [...labels].filter((c) => c !== "x").length;
  const by: Record<string, { p: number; f: number }> = {};
  for (let i = 0; i < labels.length; i++) {
    const cc = lines[i].country;
    if (!cc || labels[i] === "x") continue;
    const b = (by[cc] ??= { p: 0, f: 0 });
    b.f++; if (labels[i] === "p") b.p++;
  }
  const countries = Object.fromEntries(Object.entries(by).filter(([, b]) => b.f >= MIN_FELT).map(([cc, b]) => [cc, { positive: Math.round((b.p / b.f) * 100), lines: b.f }]));
  const mood: Mood = {
    positive: felt ? Math.round(([...labels].filter((c) => c === "p").length / felt) * 100) : 0,
    summary: out.summary.slice(0, 120),
    points: buckets.flatMap((b, k) => (b.f ? [{ at: new Date(first + (span * (k + 0.5)) / n).toISOString(), positive: Math.round((b.p / b.f) * 100) }] : [])),
    read: labels.length,
    at: new Date().toISOString(),
    countries,
  };
  cache.set(showtime, { at: Date.now(), mood });
  if (cache.size > 200) cache.delete(cache.keys().next().value!);
  return mood;
}
