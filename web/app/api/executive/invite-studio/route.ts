import type { NextRequest } from "next/server";
import { accountApi, currentAccount } from "@/lib/auth";
import { session } from "@/lib/licensing";
import { json, sameOrigin } from "@/lib/room-gate";
import { emailEnabled, sendStudioInvite } from "@/lib/email";

// POST: invite a studio by email (anyone who can open Content and studios).
const recent = new Map<string, number[]>();

export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return json(403, { error: "forbidden" });
  const s = await session();
  const me = await currentAccount();
  if (!s || !me) return json(401, { error: "Sign in first" });
  const can = await accountApi("GET", "/v1/me/exec/content", undefined, s);
  if (can.status !== 200) return json(403, { error: "Executives only" });
  const b = (await req.json().catch(() => null)) as { email?: string; studio?: string; note?: string } | null;
  const email = String(b?.email ?? "").trim().toLowerCase();
  if (!/^[^\s@,;<>]+@[^\s@,;<>]+\.[a-z]{2,}$/.test(email) || email.length > 200) return json(400, { error: "Check the email address" });
  const now = Date.now();
  const list = (recent.get(me.id) ?? []).filter((t) => now - t < 3600_000);
  if (list.length >= 30) return json(429, { error: "That is a lot of invites in an hour. Try again later." });
  recent.set(me.id, [...list, now]);
  if (!emailEnabled) return json(503, { error: "Email is not switched on here" });
  try {
    await sendStudioInvite(email, String(b?.studio ?? "").trim().slice(0, 80), me.name || "E-Cinema", String(b?.note ?? "").trim().slice(0, 400));
  } catch {
    return json(502, { error: "The invite did not send. Try again." });
  }
  return json(200, { sent: true });
}
