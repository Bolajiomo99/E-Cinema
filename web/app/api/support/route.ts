import type { NextRequest } from "next/server";
import { currentAccount } from "@/lib/auth";
import { readLocale } from "@/lib/locale";
import { json, sameOrigin } from "@/lib/room-gate";
import { allowNew, openRequest } from "@/lib/support";

// POST { topic, subject, body, email?, name? }: send a question to the E-Cinema team. Signed-in
// members write from their account's email; guests give one so the answer can reach them.
export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return json(403, { error: "forbidden" });
  const ip = (req.headers.get("cf-connecting-ip") ?? req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "anon";
  if (!allowNew(ip)) return json(429, { error: "You have sent several requests already; we will answer those first." });
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const str = (v: unknown, n: number) => (typeof v === "string" ? v.slice(0, n) : "");
  const me = await currentAccount();
  const { lang } = await readLocale();
  const r = await openRequest({
    accountId: me?.id, email: me?.email ?? str(b.email, 254), name: me?.name ?? str(b.name, 80),
    topic: str(b.topic, 20) || "other", subject: str(b.subject, 140), body: str(b.body, 5000), via: "form", lang,
  });
  if (!r.ok) return json(r.status, { error: r.error });
  return json(200, { id: r.request.id, link: `/help/r/${r.request.token}` });
}
