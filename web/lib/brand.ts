import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { accountApi } from "@/lib/auth";
import type { Check, Licensee, Rewards } from "@/lib/brand-types";

export async function verifyCode(code: string, city: string, country: string): Promise<Check | null> {
  const r = await accountApi("POST", "/v1/brand/verify", { code, city, country });
  return r.status === 200 ? (r.body as Check) : null;
}

export async function licensees(): Promise<Licensee[]> {
  const r = await accountApi("GET", "/v1/brand/licensees");
  return r.status === 200 ? (r.body as { licensees: Licensee[] }).licensees : [];
}

export async function myRewards(session: string, country?: string): Promise<Rewards | null> {
  const r = await accountApi("GET", `/v1/me/rewards?country=${country ?? ""}`, undefined, session);
  return r.status === 200 ? (r.body as Rewards) : null;
}

// The partner whose shop is at this link, by domain.
export function partnerAt(list: Licensee[], link: string): Licensee | undefined {
  let host = "";
  try {
    host = new URL(/:\/\//.test(link) ? link : `https://${link.trim()}`).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return undefined;
  }
  if (!host.includes(".")) return undefined;
  return list.find((l) => l.website && (host === l.website || host.endsWith(`.${l.website}`)));
}

// The AI check on a report (Figma 114:1733): Claude looks at the photos for the E-Cinema
// hologram and QR label, and the link is checked against the licensed partner list.
export type PhotoLook = { logoVisible: boolean; hologramVisible: boolean; qrLabelVisible: boolean; summary: string };

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["logoVisible", "hologramVisible", "qrLabelVisible", "summary"],
  properties: {
    logoVisible: { type: "boolean", description: "True if the E-CINEMA logo or name appears on the goods in any photo" },
    hologramVisible: { type: "boolean", description: "True only if a holographic security sticker is clearly visible on the goods" },
    qrLabelVisible: { type: "boolean", description: "True only if a printed QR code label is clearly visible on the goods" },
    summary: { type: "string", description: "Under 20 words: what the photos show, for a brand investigator" },
  },
} as const;

let client: Anthropic | undefined;
export const aiCheckEnabled = () => Boolean(process.env.ANTHROPIC_API_KEY);

export async function lookAtPhotos(photos: { body: Buffer; type: string }[]): Promise<PhotoLook> {
  client ??= new Anthropic();
  const res = await client.messages.create({
    model: "claude-opus-5-5",
    max_tokens: 800,
    output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA } },
    system: "You help a cinema's brand team spot counterfeit merchandise in photos sent by members. Genuine items carry an E-CINEMA hologram sticker and a printed QR authenticity label. Report only what you can see; never guess.",
    messages: [{
      role: "user",
      content: [
        ...photos.slice(0, 6).map((p) => ({ type: "image" as const, source: { type: "base64" as const, media_type: p.type as "image/jpeg" | "image/png" | "image/webp", data: p.body.toString("base64") } })),
        { type: "text" as const, text: "Look at these photos of goods being sold." },
      ],
    }],
  }, { timeout: 30_000, maxRetries: 1 });
  if (res.stop_reason === "refusal") throw new Error("refused");
  const text = res.content.find((b) => b.type === "text");
  if (!text || text.type !== "text") throw new Error("no answer");
  return JSON.parse(text.text) as PhotoLook;
}

// The sentence shown in the report form and stored for the investigator.
export function aiNote(look: PhotoLook | null, partner: Licensee | undefined, isWebLink: boolean): { note: string; tone: "warn" | "ok" | "info" } {
  const parts: string[] = [];
  if (look) {
    const missing = [!look.hologramVisible && "E‑Cinema hologram", !look.qrLabelVisible && "QR label"].filter(Boolean);
    if (missing.length) parts.push(`no ${missing.join(" or ")} is visible`);
    else parts.push("a hologram and QR label are visible, so check the code on the label too");
  }
  if (partner) parts.push(`this shop belongs to ${partner.name}, a licensed partner (${partner.licence})`);
  else if (isWebLink) parts.push("this seller is not on our licensed partner list");
  if (!parts.length) return { note: "", tone: "info" };
  const s = parts.join(", and ");
  const warn = !partner && (!look || !look.hologramVisible || !look.qrLabelVisible);
  return { note: `AI check: ${s}.`, tone: partner ? "ok" : warn ? "warn" : "info" };
}
