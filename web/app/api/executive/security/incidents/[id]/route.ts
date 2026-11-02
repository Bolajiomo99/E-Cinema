import type { NextRequest } from "next/server";
import { accountApi } from "@/lib/auth";
import { session } from "@/lib/licensing";
import { json, sameOrigin } from "@/lib/room-gate";

// PUT { closed }: close or reopen an incident. CEO and CTO only (the API checks).
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!sameOrigin(req)) return json(403, { error: "forbidden" });
  const s = await session();
  if (!s) return json(401, { error: "Sign in first" });
  const { id } = await params;
  if (!/^\d{1,18}$/.test(id)) return json(400, { error: "bad incident" });
  const b = (await req.json().catch(() => ({}))) as { closed?: unknown };
  const r = await accountApi("PUT", `/v1/me/exec/security/incidents/${id}`, { closed: b.closed === true }, s);
  return json(r.status, r.body ?? {});
}
