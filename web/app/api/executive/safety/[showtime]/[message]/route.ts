import type { NextRequest } from "next/server";
import { accountApi } from "@/lib/auth";
import { session } from "@/lib/licensing";
import { json, sameOrigin } from "@/lib/room-gate";

// POST { remove }: settle the reports on a world-chat message (the API checks who may).
export async function POST(req: NextRequest, { params }: { params: Promise<{ showtime: string; message: string }> }) {
  if (!sameOrigin(req)) return json(403, { error: "forbidden" });
  const s = await session();
  if (!s) return json(401, { error: "Sign in first" });
  const { showtime, message } = await params;
  if (!/^[a-z0-9-]{1,80}$/.test(showtime) || !/^\d{1,18}$/.test(message)) return json(400, { error: "Bad request" });
  const b = (await req.json().catch(() => ({}))) as { remove?: unknown };
  const r = await accountApi("POST", `/v1/me/exec/safety/${showtime}/${message}`, { remove: b.remove === true }, s);
  return json(r.status, r.body ?? {});
}
