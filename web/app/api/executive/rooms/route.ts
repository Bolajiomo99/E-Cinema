import type { NextRequest } from "next/server";
import { accountApi } from "@/lib/auth";
import { session } from "@/lib/licensing";
import { json, sameOrigin } from "@/lib/room-gate";

// PUT: add or change a room type (the API checks who may).
export async function PUT(req: NextRequest) {
  if (!sameOrigin(req)) return json(403, { error: "forbidden" });
  const s = await session();
  if (!s) return json(401, { error: "Sign in first" });
  const body = await req.json().catch(() => null);
  if (!body) return json(400, { error: "Bad request" });
  const r = await accountApi("PUT", "/v1/me/exec/rooms", body, s);
  if (r.status === 400) return json(400, { error: "Give the room a name, a type and a hall that fits it" });
  return json(r.status, r.body ?? {});
}
