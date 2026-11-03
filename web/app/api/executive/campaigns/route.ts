import type { NextRequest } from "next/server";
import { accountApi } from "@/lib/auth";
import { session } from "@/lib/licensing";
import { json, sameOrigin } from "@/lib/room-gate";
import { execCampaigns } from "@/lib/exec";
import { translateCampaign } from "@/lib/campaign-ai";
import { runDueCampaigns } from "@/lib/campaign-worker";
import { LANGS } from "@/lib/i18n";

// POST: create an announcement (Figma 51:375). With translate on, Claude writes it in every app
// language members use before it is saved. Sent now unless sendAt is later. CEO and CMO only.
export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return json(403, { error: "forbidden" });
  const s = await session();
  if (!s) return json(401, { error: "Sign in first" });
  const page = await execCampaigns(s);
  if (!page) return json(403, { error: "Only the CEO and the CMO can send announcements" });
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const str = (v: unknown, n: number) => (typeof v === "string" ? v.trim().slice(0, n) : "");
  const title = str(b.title, 120), body = str(b.body, 300);
  const channels = Array.isArray(b.channels) ? b.channels.filter((c): c is string => c === "inapp" || c === "email") : [];
  const sendAt = typeof b.sendAt === "string" && b.sendAt && !Number.isNaN(Date.parse(b.sendAt)) ? new Date(b.sendAt).toISOString() : "";
  let texts: { lang: string; title: string; body: string }[] = [];
  if (b.translate === true && title.length >= 3) {
    const langs = page.languages.map((l) => l.lang).filter((l) => l !== "en" && /^[a-z]{2,3}(-[A-Za-z]{2,4})?$/.test(l)).slice(0, 40)
      .map((code) => ({ code, name: LANGS.find(([c]) => c === code)?.[1] ?? code }));
    texts = await translateCampaign(title, body, langs).catch(() => []);
  }
  const r = await accountApi("POST", "/v1/me/exec/campaigns", {
    title, body, link: str(b.link, 200), audience: str(b.audience, 20), country: str(b.country, 2), channels, sendAt: sendAt || undefined, texts,
  }, s);
  if (r.status !== 200) return json(r.status, r.body ?? {});
  if (!sendAt || Date.parse(sendAt) <= Date.now()) await runDueCampaigns();
  return json(200, r.body);
}
