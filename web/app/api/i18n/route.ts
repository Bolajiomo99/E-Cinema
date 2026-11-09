import type { NextRequest } from "next/server";
import { isLang } from "@/lib/i18n";
import { json, sameOrigin } from "@/lib/room-gate";
import { translateStrings } from "@/lib/translate";

// POST { lang, strings }: the page's English text in the visitor's language, from the translation
// memory (new strings are translated once and kept). Same-origin only, with a cap per visitor on
// how many new strings they can send an hour, so it cannot be used as a free translator.
const LIMIT = 4000; // new strings per visitor per hour
const g = globalThis as unknown as { __ecTrUse?: Map<string, { at: number; n: number }> };
const use = (g.__ecTrUse ??= new Map());

export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return json(403, { error: "forbidden" });
  const b = (await req.json().catch(() => ({}))) as { lang?: string; strings?: unknown };
  if (!isLang(b.lang) || !Array.isArray(b.strings)) return json(400, { error: "lang and strings required" });
  const strings = b.strings.filter((s): s is string => typeof s === "string" && s.length > 0 && s.length <= 2000).slice(0, 400);
  const ip = (req.headers.get("cf-connecting-ip") ?? req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "anon";
  const now = Date.now();
  const u = use.get(ip);
  const fresh = !u || now - u.at > 3600_000 ? { at: now, n: 0 } : u;
  fresh.n += strings.length;
  use.set(ip, fresh);
  if (use.size > 50_000) use.clear();
  const map = await translateStrings(b.lang, strings, { allowNew: fresh.n <= LIMIT });
  return json(200, { map });
}
