import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { accountApi } from "@/lib/auth";
import { findShowtime } from "@/lib/catalog";

// The viewer's own numbers for Insights (Figma 19:462), from api/internal/insights.
export type Totals = { seconds: number; premieres: number; messages: number; countries: number; spent: Record<string, number> };
export type Report = {
  from: string; to: string; current: Totals; previous: Totals;
  months: { month: string; seconds: number }[];
  films: { showtimeId: string; seconds: number }[];
  languages: { lang: string; kind: "audio" | "subs"; seconds: number }[];
  chats: { country: string; messages: number }[];
};
export type Range = "month" | "6m" | "all";

export async function myInsights(session: string, range: Range): Promise<Report | null> {
  const r = await accountApi("GET", `/v1/me/insights?range=${range === "month" ? "" : range}`, undefined, session);
  return r.status === 200 ? (r.body as Report) : null;
}

// Watch time by genre, from the films watched and their catalogue genres.
export function genreShare(films: Report["films"]): { genre: string; share: number }[] {
  const by = new Map<string, number>();
  let total = 0;
  for (const f of films) {
    const g = findShowtime(f.showtimeId)?.genres ?? ["Other"];
    for (const x of g) by.set(x, (by.get(x) ?? 0) + f.seconds / g.length);
    total += f.seconds;
  }
  return [...by].map(([genre, s]) => ({ genre, share: total ? s / total : 0 })).sort((a, b) => b.share - a.share);
}

export type Note = { title: string; body: string };

const SCHEMA = {
  type: "object", additionalProperties: false, required: ["notes"],
  properties: {
    notes: {
      type: "array",
      items: { type: "object", additionalProperties: false, required: ["title", "body"], properties: { title: { type: "string", description: "Under 32 characters" }, body: { type: "string", description: "One or two short sentences" } } },
    },
  },
} as const;

let client: Anthropic | undefined;
export const insightsAiEnabled = () => Boolean(process.env.ANTHROPIC_API_KEY);

// "E-Cinema AI noticed" (Pro): a few observations from the viewer's own numbers, plus the
// next premiere that fits their taste. Only facts in the input may be used.
export async function aiNotes(report: Report, upcoming: { film: string; genres: string[]; startsAt: string }[], plan: string): Promise<Note[]> {
  client ??= new Anthropic();
  const facts = {
    plan,
    thisPeriod: report.current,
    previousPeriod: report.previous,
    hoursByMonth: report.months.map((m) => ({ month: m.month, hours: Math.round(m.seconds / 360) / 10 })),
    genres: genreShare(report.films).slice(0, 5).map((g) => ({ genre: g.genre, percent: Math.round(g.share * 100) })),
    languages: report.languages,
    chatCountries: report.chats,
    upcomingPremieres: upcoming.slice(0, 8),
  };
  const res = await client.messages.create({
    model: "claude-opus-5-5",
    max_tokens: 1200,
    output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA } },
    system: "You write the 'E-Cinema AI noticed' card on a viewer's personal insights page for a global online cinema. Give 3 or 4 short, warm, specific observations using only the numbers given (never invent figures, times or prices). One should recommend the best-matching upcoming premiere by name. If there is little data, say what will appear once they watch more. Money is in minor units (cents) by currency.",
    messages: [{ role: "user", content: JSON.stringify(facts) }],
  }, { timeout: 30_000, maxRetries: 1 });
  const text = res.content.find((b) => b.type === "text");
  if (res.stop_reason === "refusal" || !text || text.type !== "text") return [];
  return ((JSON.parse(text.text) as { notes: Note[] }).notes ?? []).slice(0, 4).map((n) => ({ title: n.title.slice(0, 60), body: n.body.slice(0, 240) }));
}
