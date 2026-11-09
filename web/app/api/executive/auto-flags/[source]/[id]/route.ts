import type { NextRequest } from "next/server";
import { accountApi } from "@/lib/auth";
import { session } from "@/lib/licensing";
import { json, sameOrigin } from "@/lib/room-gate";

// POST { remove }: settle an automatic flag, keeping the item hidden or putting it back (the API checks who may).
export async function POST(req: NextRequest, { params }: { params: Promise<{ source: string; id: string }> }) {
  if (!sameOrigin(req)) return json(403, { error: "forbidden" });
  const s = await session();
  if (!s) return json(401, { error: "Sign in first" });
  const { source, id } = await params;
  if (!/^(room|post|comment)$/.test(source) || !/^\d{1,18}$/.test(id)) return json(400, { error: "Bad request" });
  const b = (await req.json().catch(() => ({}))) as { remove?: unknown };
  const r = await accountApi("POST", `/v1/me/exec/auto-flags/${source}/${id}`, { remove: b.remove === true }, s);
  return json(r.status, r.body ?? {});
}
