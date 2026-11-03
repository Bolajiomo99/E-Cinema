import type { NextRequest } from "next/server";
import { accountApi } from "@/lib/auth";
import { session } from "@/lib/licensing";
import { json, sameOrigin } from "@/lib/room-gate";

// PUT { body }: the CEO's message to stakeholders (the API checks it is the CEO).
export async function PUT(req: NextRequest) {
  if (!sameOrigin(req)) return json(403, { error: "forbidden" });
  const s = await session();
  if (!s) return json(401, { error: "Sign in first" });
  const b = (await req.json().catch(() => ({}))) as { body?: unknown };
  const r = await accountApi("PUT", "/v1/me/exec/stakeholder/note", { body: typeof b.body === "string" ? b.body : "" }, s);
  return json(r.status, r.body ?? {});
}
