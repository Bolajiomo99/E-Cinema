import "server-only";
import Anthropic from "@anthropic-ai/sdk";

// Piracy protection (Figma 39:578): Claude drafts the takedown notice a studio sends to the
// site, app or host carrying a leaked copy. The studio reads it, edits it and sends it.

export type NoticeInput = {
  rightsHolder: string; country: string; contact: string; film: string; link: string;
  place: string; kind: string; what: string; date: string;
};

let client: Anthropic | null = null;

export async function draftNotice(n: NoticeInput): Promise<string | null> {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  client ??= new Anthropic();
  const res = await client.messages.create({
    model: "claude-sonnet-5-5",
    max_tokens: 1500,
    output_config: { effort: "low" },
    system: "You write copyright takedown notices for film studios. Write one plain-text notice the studio can send as an email or paste into the platform's copyright form. " +
      "Use only the facts given; never invent registration numbers, addresses, laws of a country not given, or a person's name. Where a fact is missing, leave a clear [square bracket] placeholder. " +
      "Include: the copyrighted work and who owns it, the exact infringing link, a request to remove it, a good-faith statement, an accuracy statement under penalty of perjury, and a signature line for the rights holder. " +
      "Cite the DMCA (17 U.S.C. § 512) and, if the rights holder's country is Nigeria, also the Copyright Act 2022 of Nigeria. Under 350 words. No markdown.",
    messages: [{ role: "user", content: JSON.stringify(n) }],
  }, { timeout: 60_000, maxRetries: 1 });
  const t = res.content.find((b) => b.type === "text");
  if (res.stop_reason === "refusal" || !t || t.type !== "text") return null;
  return t.text.trim().slice(0, 6000);
}
