import "server-only";
import Anthropic from "@anthropic-ai/sdk";

// Reads a photo of a student ID card with Claude (Figma 94:1327: "checked by AI in seconds").
// The photo is never stored: it is sent once, read, and dropped.
export type CardRead = { isStudentCard: boolean; name: string; school: string; expires: string; looksAltered: boolean; reason: string };

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["isStudentCard", "name", "school", "expires", "looksAltered", "reason"],
  properties: {
    isStudentCard: { type: "boolean", description: "True only for a student identity card issued by a school, college or university" },
    name: { type: "string", description: "The student's full name exactly as printed, or empty" },
    school: { type: "string", description: "The school, college or university name as printed, or empty" },
    expires: { type: "string", description: "Expiry or valid-until date as YYYY-MM-DD, or empty if none is printed" },
    looksAltered: { type: "boolean", description: "True if the card looks edited, a screen photo of a template, or a sample card" },
    reason: { type: "string", description: "One short sentence for the viewer when the card cannot be accepted, else empty" },
  },
} as const;

let client: Anthropic | undefined;
export const idCheckEnabled = () => Boolean(process.env.ANTHROPIC_API_KEY);

export async function readStudentCard(image: Buffer, mediaType: "image/jpeg" | "image/png" | "image/webp", today = new Date()): Promise<CardRead> {
  client ??= new Anthropic();
  const res = await client.messages.create({
    model: "claude-opus-5-5",
    max_tokens: 1000,
    output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA } },
    system: `You check photos of student ID cards for a cinema's student discount. Read only what is printed on the card. Never guess a name, school or date that you cannot read. Today is ${today.toISOString().slice(0, 10)}.`,
    messages: [{
      role: "user",
      content: [
        { type: "image", source: { type: "base64", media_type: mediaType, data: image.toString("base64") } },
        { type: "text", text: "Read this card." },
      ],
    }],
  }, { timeout: 30_000, maxRetries: 1 });
  if (res.stop_reason === "refusal") throw new Error("refused");
  const text = res.content.find((b) => b.type === "text");
  if (!text || text.type !== "text") throw new Error("no answer");
  return JSON.parse(text.text) as CardRead;
}

// The card must carry the account holder's name: every word of the shorter name appears in the longer one.
export function namesMatch(account: string, card: string) {
  const words = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().split(/[^a-z]+/).filter((w) => w.length > 1);
  const a = words(account), c = words(card);
  if (!a.length || !c.length) return false;
  const [short, long] = a.length <= c.length ? [a, c] : [c, a];
  return short.length >= Math.min(2, long.length) && short.every((w) => long.includes(w));
}
