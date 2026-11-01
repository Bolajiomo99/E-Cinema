import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { cookies } from "next/headers";
import { accountApi, SESSION_COOKIE } from "@/lib/auth";
import type { Check, Licensee } from "@/lib/licensing-types";

export async function session() {
  return (await cookies()).get(SESSION_COOKIE)?.value ?? "";
}

export async function myLicence(s: string): Promise<{ licensee: Licensee; identityOk: boolean } | null> {
  if (!s) return null;
  const r = await accountApi("GET", "/v1/me/partner", undefined, s);
  return r.status === 200 ? (r.body as { licensee: Licensee; identityOk: boolean }) : null;
}

export async function partnerPage<T>(s: string, page: string, query = ""): Promise<T | null> {
  const r = await accountApi("GET", `/v1/me/partner/${page}${query ? `?${query}` : ""}`, undefined, s);
  return r.status === 200 ? (r.body as T) : null;
}

let client: Anthropic | undefined;
export const aiEnabled = () => Boolean(process.env.ANTHROPIC_API_KEY);
const ai = () => (client ??= new Anthropic());

function textOf(res: Anthropic.Message) {
  if (res.stop_reason === "refusal") throw new Error("refused");
  const t = res.content.find((b) => b.type === "text");
  if (!t || t.type !== "text") throw new Error("no answer");
  return t.text;
}

// Reads a certificate of incorporation (Figma 116:38: "PDF uploaded · checked by AI").
export type DocRead = { isRegistration: boolean; company: string; number: string; matches: boolean; note: string };
const DOC_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["isRegistration", "company", "number", "matches", "note"],
  properties: {
    isRegistration: { type: "boolean", description: "True only for a company registration or incorporation certificate issued by a government registry" },
    company: { type: "string", description: "Company name exactly as printed, or empty" },
    number: { type: "string", description: "Registration number exactly as printed, or empty" },
    matches: { type: "boolean", description: "True if the printed company name and number match the ones the applicant typed" },
    note: { type: "string", description: "Under 15 words for the applicant: what was read, or what is wrong" },
  },
} as const;

export async function readCertificate(file: Buffer, type: string, company: string, number: string): Promise<DocRead> {
  const source = type === "application/pdf"
    ? { type: "document" as const, source: { type: "base64" as const, media_type: "application/pdf" as const, data: file.toString("base64") } }
    : { type: "image" as const, source: { type: "base64" as const, media_type: type as "image/jpeg" | "image/png" | "image/webp", data: file.toString("base64") } };
  const res = await ai().messages.create({
    model: "claude-opus-5-5",
    max_tokens: 800,
    output_config: { effort: "low", format: { type: "json_schema", schema: DOC_SCHEMA } },
    system: "You check company registration certificates for a brand licensing programme. Read only what is printed; never guess.",
    messages: [{ role: "user", content: [source, { type: "text", text: `The applicant typed company "${company}" and registration number "${number}".` }] }],
  }, { timeout: 45_000, maxRetries: 1 });
  return JSON.parse(textOf(res)) as DocRead;
}

// The brand rules check on a product design (Figma 116:300), before a person reviews it.
const RULES_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["logoOk", "logoDetail", "artworkNeedsRights", "artworkDetail"],
  properties: {
    logoOk: { type: "boolean", description: "True if any E-CINEMA logo shown is red (#E3182D) or white, undistorted, with clear space around it and away from seams" },
    logoDetail: { type: "string", description: "Under 12 words on the logo colour and spacing" },
    artworkNeedsRights: { type: "boolean", description: "True if the design uses film artwork, characters, posters or titles besides the E-CINEMA logo" },
    artworkDetail: { type: "string", description: "Under 12 words naming any film artwork seen, or empty" },
  },
} as const;

export async function brandRules(image: Buffer, type: string, film: string, licensedFilms: string[]): Promise<Check[]> {
  const res = await ai().messages.create({
    model: "claude-opus-5-5",
    max_tokens: 600,
    output_config: { effort: "low", format: { type: "json_schema", schema: RULES_SCHEMA } },
    system: "You check merchandise designs against the E-Cinema brand guide: the E-CINEMA wordmark is red #E3182D or white on dark, never stretched or recoloured, with clear space and not on seams. Report only what you can see.",
    messages: [{ role: "user", content: [
      { type: "image", source: { type: "base64", media_type: type as "image/jpeg" | "image/png" | "image/webp", data: image.toString("base64") } },
      { type: "text", text: `Check this design.${film ? ` The partner says it uses artwork from "${film}".` : ""}` },
    ] }],
  }, { timeout: 45_000, maxRetries: 1 });
  const r = JSON.parse(textOf(res)) as { logoOk: boolean; logoDetail: string; artworkNeedsRights: boolean; artworkDetail: string };
  const checks: Check[] = [{ name: "Logo colour and spacing", detail: r.logoOk ? "Matches the brand guide" : r.logoDetail || "Does not match the brand guide", result: r.logoOk ? "pass" : "fail" }];
  if (r.artworkNeedsRights || film) {
    const known = film && licensedFilms.some((f) => f.toLowerCase() === film.toLowerCase());
    checks.push({ name: "Film artwork rights", detail: known ? `${film} artwork is licensed through E‑Cinema` : film ? `${film}: the brand team confirms the studio's approval` : r.artworkDetail || "Film artwork found: name the film", result: known ? "pass" : "needed" });
  }
  return checks;
}

// Signed links for a product's design and sample pictures (both kept private in media storage).
const PIC = /^licensing\/[0-9a-f-]{36}\.(jpg|png|webp)$/;
export async function withPictures<T extends { imageKey: string; sampleKey: string }>(list: T[]): Promise<(T & { image?: string; sample?: string })[]> {
  const { mediaEnabled, roomObjectLink } = await import("@/lib/media");
  const link = async (k: string) => (mediaEnabled && PIC.test(k) ? roomObjectLink(k) : undefined);
  return Promise.all(list.map(async (x) => ({ ...x, image: await link(x.imageKey), sample: await link(x.sampleKey) })));
}
