import type { NextRequest } from "next/server";
import { accountApi } from "@/lib/auth";
import { session } from "@/lib/licensing";
import { json, sameOrigin } from "@/lib/room-gate";

// PUT { id, quarter, title, done }: add (id 0) or change an investor milestone. The CEO only (the API checks).
export async function PUT(req: NextRequest) {
  if (!sameOrigin(req)) return json(403, { error: "forbidden" });
  const s = await session();
  if (!s) return json(401, { error: "Sign in first" });
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const r = await accountApi("PUT", "/v1/me/exec/milestones", {
    id: Number.isSafeInteger(b.id) ? b.id : 0, quarter: typeof b.quarter === "string" ? b.quarter : "", title: typeof b.title === "string" ? b.title : "", done: b.done === true,
  }, s);
  return json(r.status, r.body ?? {});
}
