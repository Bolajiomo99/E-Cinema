import type { NextRequest } from "next/server";
import { json, sameOrigin } from "@/lib/room-gate";
import { replyByToken } from "@/lib/support";

// POST { body }: the person adds to their request from its private link.
export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  if (!sameOrigin(req)) return json(403, { error: "forbidden" });
  const { token } = await params;
  const b = (await req.json().catch(() => ({}))) as { body?: unknown };
  const r = await replyByToken(token, typeof b.body === "string" ? b.body.slice(0, 5000) : "");
  return json(r.status, r.body ?? {});
}
