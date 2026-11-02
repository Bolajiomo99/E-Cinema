import type { NextRequest } from "next/server";
import { accountApi } from "@/lib/auth";
import { session } from "@/lib/licensing";
import { json, sameOrigin } from "@/lib/room-gate";

// POST: approve a studio whose documents the desk already checked (CEO or COO).
export async function POST(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  if (!sameOrigin(req)) return json(403, { error: "forbidden" });
  const s = await session();
  if (!s) return json(401, { error: "Sign in first" });
  const { slug } = await params;
  if (!/^[a-z0-9-]{1,90}$/.test(slug)) return json(404, { error: "Not found" });
  const r = await accountApi("POST", `/v1/me/exec/studios/${slug}/approve`, {}, s);
  return r.status === 204 ? new Response(null, { status: 204 }) : json(r.status, r.body ?? {});
}
