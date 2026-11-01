import { cookies } from "next/headers";
import { accountApi, SESSION_COOKIE } from "@/lib/auth";
import { json, sameOrigin } from "@/lib/room-gate";

// Start a rewatch party for a film in the viewer's library.
export async function POST(req: Request) {
  if (!sameOrigin(req)) return json(403, { error: "forbidden" });
  const session = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!session) return json(401, { error: "Sign in first" });
  const b = (await req.json().catch(() => ({}))) as { showtimeId?: string; startsAt?: string };
  const r = await accountApi("POST", "/v1/me/rewatch", { showtimeId: b.showtimeId, startsAt: b.startsAt }, session);
  return json(r.status, r.body ?? {});
}
