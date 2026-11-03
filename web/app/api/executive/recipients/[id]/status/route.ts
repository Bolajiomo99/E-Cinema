import type { NextRequest } from "next/server";
import { accountApi } from "@/lib/auth";
import { session } from "@/lib/licensing";
import { json, sameOrigin } from "@/lib/room-gate";

// PUT { status: "active" | "paused" }: switch a recipient on or off. The CEO only (the API checks).
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!sameOrigin(req)) return json(403, { error: "forbidden" });
  const s = await session();
  if (!s) return json(401, { error: "Sign in first" });
  const { id } = await params;
  const b = (await req.json().catch(() => ({}))) as { status?: unknown };
  const r = await accountApi("PUT", `/v1/me/exec/recipients/${encodeURIComponent(id)}/status`, { status: typeof b.status === "string" ? b.status : "" }, s);
  return json(r.status, r.body ?? {});
}
