import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { marketOf } from "@/lib/premiere-types";

// "Use AI suggested prices" (Figma 35:514): Claude proposes a ticket price per country from the
// base price, the film and what has sold so far, with a one-line note the studio can act on.
let client: Anthropic | null = null;

export type Suggestion = { country: string; price: number; note: string };
type Row = { country: string; currency: string; current: number | null; usd: number | null; sold: number };

export async function suggestPrices(film: { title: string; genres: string; languages: string; runtime: string; baseUsd: number; seats: number; startsAt: string | null }, rows: Row[]): Promise<Suggestion[] | null> {
  if (!process.env.ANTHROPIC_API_KEY || !rows.length) return null;
  client ??= new Anthropic();
  const res = await client.messages.create({
    model: "claude-opus-5-5",
    max_tokens: 4000,
    output_config: {
      effort: "low",
      format: {
        type: "json_schema",
        schema: {
          type: "object", additionalProperties: false, required: ["prices"],
          properties: {
            prices: {
              type: "array",
              items: {
                type: "object", additionalProperties: false, required: ["country", "price", "note"],
                properties: {
                  country: { type: "string", description: "Two-letter country code from the input" },
                  price: { type: "number", description: "Suggested ticket price in the country's currency, in major units, rounded the way local prices usually are" },
                  note: { type: "string", description: "Under 60 characters. 'Looks right' when the current price is fine, otherwise the reason or the action to take" },
                },
              },
            },
          },
        },
      },
    },
    system: "You price online cinema premiere tickets for a film studio. Price for local buying power and what a cinema ticket costs in each country, so a seat sells out without leaving money on the table. Use the seats already sold as a demand signal. Never invent data you were not given; base notes only on the input. Keep each note short and plain.",
    messages: [{ role: "user", content: JSON.stringify({ film, countries: rows.map((r) => ({ ...r, name: marketOf(r.country)?.name })) }) }],
  }, { timeout: 60_000, maxRetries: 1 });
  if (res.stop_reason === "refusal" || res.stop_reason === "max_tokens") return null;
  const t = res.content.find((b) => b.type === "text");
  if (!t || t.type !== "text") return null;
  const out = (JSON.parse(t.text) as { prices: Suggestion[] }).prices;
  const want = new Set(rows.map((r) => r.country));
  return out.filter((s) => want.has(s.country) && Number.isFinite(s.price) && s.price > 0).map((s) => ({ ...s, note: s.note.slice(0, 160) }));
}
