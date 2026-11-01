import { cookies } from "next/headers";
import { accountApi, SESSION_COOKIE } from "@/lib/auth";
import { json, sameOrigin } from "@/lib/room-gate";

// Player heartbeats for Insights; the Go API caps each beat and ignores beats sent too fast.
export async function POST(req: Request) {
  if (!sameOrigin(req)) return json(403, { error: "forbidden" });
  const session = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!session) return json(401, { error: "Sign in first" });
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const r = await accountApi("POST", "/v1/me/watch-beats", { showtimeId: b.showtimeId, mode: b.mode, audio: b.audio ?? "", subs: b.subs ?? "", seconds: b.seconds }, session);
  return json(r.status, r.body ?? {});
}
