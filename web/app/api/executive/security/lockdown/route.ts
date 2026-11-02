import type { NextRequest } from "next/server";
import { accountApi } from "@/lib/auth";
import { session } from "@/lib/licensing";
import { json, sameOrigin } from "@/lib/room-gate";

// PUT { on }: lock down mode. Only the CEO and CTO (the API checks).
export async function PUT(req: NextRequest) {
  if (!sameOrigin(req)) return json(403, { error: "forbidden" });
  const s = await session();
  if (!s) return json(401, { error: "Sign in first" });
  const b = (await req.json().catch(() => ({}))) as { on?: unknown };
  const r = await accountApi("PUT", "/v1/me/exec/security/lockdown", { on: b.on === true }, s);
  return json(r.status, r.body ?? {});
}
