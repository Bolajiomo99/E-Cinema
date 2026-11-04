import type { NextRequest } from "next/server";
import { accountApi } from "@/lib/auth";
import { session } from "@/lib/licensing";
import { json, sameOrigin } from "@/lib/room-gate";
import { emailEnabled, sendExecInviteCode } from "@/lib/email";

// Executive invite steps (Figma 99:1696): send the inbox code, check it, and accept.
export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string; action: string }> }) {
  if (!sameOrigin(req)) return json(403, { error: "forbidden" });
  const { token, action } = await params;
  if (!/^[A-Za-z0-9_-]{20,80}$/.test(token) || !["code", "confirm", "accept"].includes(action)) return json(404, { error: "Not found" });
  const s = await session();
  if (!s) return json(401, { error: "Sign in first" });
  const body = action === "confirm" ? await req.json().catch(() => ({})) : {};
  const r = await accountApi("POST", `/v1/exec-invites/${token}/${action}`, body, s);
  if (r.status !== 200 || action !== "code") return json(r.status, r.body ?? {});
  const { code, email } = r.body as { code: string; email: string };
  if (emailEnabled) {
    try { await sendExecInviteCode(email, code); } catch { return json(502, { error: "We could not send the email just now. Try again in a minute." }); }
  } else if (process.env.E2E_LOG_CODES) console.log(`[e2e] exec invite code for ${email}: ${code}`);
  else return json(503, { error: "Email is not switched on here, so the code cannot be sent." });
  return json(200, { sent: true });
}
