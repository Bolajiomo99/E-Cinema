import "server-only";
import Anthropic from "@anthropic-ai/sdk";

// Notifications and re-engagement (Figma 51:375): Claude translates an announcement into each
// app language the audience uses, so every member reads it in their own language.
let client: Anthropic | null = null;

export type Translation = { lang: string; title: string; body: string };

export async function translateCampaign(title: string, body: string, langs: { code: string; name: string }[]): Promise<Translation[]> {
  if (!process.env.ANTHROPIC_API_KEY || langs.length === 0) return [];
  client ??= new Anthropic();
  const res = await client.messages.create({
    model: "claude-sonnet-5-5",
    max_tokens: 8000,
    output_config: {
      effort: "low",
      format: {
        type: "json_schema",
        schema: {
          type: "object", additionalProperties: false, required: ["items"],
          properties: {
            items: {
              type: "array",
              items: {
                type: "object", additionalProperties: false, required: ["lang", "title", "body"],
                properties: {
                  lang: { type: "string", description: "The language code exactly as given" },
                  title: { type: "string", description: "The title in that language, under 120 characters" },
                  body: { type: "string", description: "The message in that language, under 300 characters; empty if the message is empty" },
                },
              },
            },
          },
        },
      },
    },
    system: "You translate short in-app announcements for E-Cinema, an online cinema that live streams new films. Translate naturally for each language, keep the same meaning and tone, " +
      "keep the brand name E-Cinema, film titles and numbers as they are, and add nothing. Return one item per language requested.",
    messages: [{ role: "user", content: JSON.stringify({ title, body, languages: langs }) }],
  }, { timeout: 90_000, maxRetries: 1 });
  const t = res.content.find((b) => b.type === "text");
  if (res.stop_reason !== "end_turn" || !t || t.type !== "text") return [];
  try {
    const out = JSON.parse(t.text) as { items?: Translation[] };
    const want = new Set(langs.map((l) => l.code));
    return (out.items ?? []).filter((x) => want.has(x.lang) && x.title).map((x) => ({ lang: x.lang, title: x.title.slice(0, 120), body: x.body.slice(0, 300) }));
  } catch {
    return [];
  }
}
