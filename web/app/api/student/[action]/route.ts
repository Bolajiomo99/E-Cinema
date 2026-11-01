import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { accountApi, currentAccount, SESSION_COOKIE } from "@/lib/auth";
import { emailEnabled, sendStudentCode } from "@/lib/email";
import { idCheckEnabled, namesMatch, readStudentCard } from "@/lib/student-id";

// Student offer (Figma 94:1327): code to a school email, or a student ID photo read by AI.
export const dynamic = "force-dynamic";

const json = (status: number, body: unknown) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
const TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX = 5 * 1024 * 1024;
// Simple per-instance limit on ID reads: each one costs an AI call.
const reads = new Map<string, number[]>();

export async function POST(req: NextRequest, { params }: { params: Promise<{ action: string }> }) {
  const origin = req.headers.get("origin");
  if (origin && new URL(origin).host !== req.headers.get("host")) return json(403, { error: "forbidden" });
  const session = (await cookies()).get(SESSION_COOKIE)?.value;
  const me = await currentAccount();
  if (!session || !me) return json(401, { error: "Sign in first", signIn: true });
  const { action } = await params;

  if (action === "code") {
    if (!emailEnabled && process.env.NODE_ENV === "production" && !process.env.E2E_LOG_CODES) return json(503, { error: "Codes by email are being switched on. Please upload your student ID instead." });
    const b = (await req.json().catch(() => ({}))) as { school?: string; email?: string };
    const r = await accountApi("POST", "/v1/me/student/code", { school: b.school ?? "", email: b.email ?? "" }, session);
    if (r.status !== 200) return json(r.status, r.body ?? {});
    const out = r.body as { code?: string; email?: string; maskedTo: string };
    if (out.code && out.email) {
      if (emailEnabled) {
        try {
          await sendStudentCode(out.email, out.code, (b.school ?? "").trim());
        } catch {
          return json(502, { error: "We could not send the email just now. Please try again in a minute." });
        }
      } else if (process.env.E2E_LOG_CODES) console.log(`[e2e] student code for ${out.email}: ${out.code}`);
    }
    return json(200, { maskedTo: out.maskedTo });
  }

  if (action === "verify") {
    const b = (await req.json().catch(() => ({}))) as { code?: string };
    const r = await accountApi("POST", "/v1/me/student/verify", { code: String(b.code ?? "").replace(/\D/g, "") }, session);
    return json(r.status, r.body ?? {});
  }

  if (action === "id") {
    if (!idCheckEnabled()) return json(503, { error: "ID checks are paused right now. Please use your school email instead." });
    const now = Date.now();
    const recent = (reads.get(me.id) ?? []).filter((t) => now - t < 3_600_000);
    if (recent.length >= 5) return json(429, { error: "That is five tries this hour. Please wait, or use your school email." });
    reads.set(me.id, [...recent, now]);
    const form = await req.formData().catch(() => null);
    const file = form?.get("card");
    if (!(file instanceof File) || !TYPES.has(file.type)) return json(400, { error: "Upload a JPG, PNG or WebP photo of your student ID." });
    if (file.size > MAX) return json(400, { error: "The photo is over 5 MB. Please send a smaller one." });
    let card;
    try {
      card = await readStudentCard(Buffer.from(await file.arrayBuffer()), file.type as "image/jpeg");
    } catch {
      return json(502, { error: "We could not read the photo just now. Please try again, or use your school email." });
    }
    if (!card.isStudentCard || card.looksAltered) return json(422, { error: card.reason || "That does not look like a student ID card. Try a clear photo of the front." });
    if (!namesMatch(me.name, card.name)) return json(422, { error: `The name on the card does not match the name on your account (${me.name}). Change your account name in Settings if it is wrong.` });
    const expires = /^\d{4}-\d{2}-\d{2}$/.test(card.expires) ? new Date(`${card.expires}T23:59:59Z`) : null;
    if (expires && expires.getTime() < now) return json(422, { error: "That student ID has expired. Upload this year's card." });
    const r = await accountApi("POST", "/v1/internal/student/id", { accountId: me.id, school: card.school, expires: expires?.toISOString() ?? "0001-01-01T00:00:00Z" });
    return json(r.status, r.body ?? {});
  }
  return json(404, { error: "not found" });
}
