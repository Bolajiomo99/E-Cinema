import type { NextRequest } from "next/server";
import { accountApi } from "@/lib/auth";
import { session } from "@/lib/licensing";
import { json, sameOrigin } from "@/lib/room-gate";
import { emailBatch } from "@/lib/campaign-worker";

// POST .../test sends a scheduled announcement to 1% of its audience; .../cancel stops it.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string; action: string }> }) {
  if (!sameOrigin(req)) return json(403, { error: "forbidden" });
  const s = await session();
  if (!s) return json(401, { error: "Sign in first" });
  const { id, action } = await params;
  if (!/^\d{1,12}$/.test(id) || (action !== "test" && action !== "cancel")) return json(404, { error: "not found" });
  const r = await accountApi("POST", `/v1/me/exec/campaigns/${id}/${action}`, {}, s);
  if (r.status !== 200 || action === "cancel") return json(r.status, r.body ?? {});
  const batch = r.body as { members: number; campaign: { id: number; link: string }; recipients: { email: string; name: string; title: string; body: string }[] };
  const emailed = await emailBatch(batch);
  return json(200, { members: batch.members, emailed });
}
