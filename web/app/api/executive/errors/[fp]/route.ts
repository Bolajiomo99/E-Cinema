import type { NextRequest } from "next/server";
import { accountApi } from "@/lib/auth";
import { session } from "@/lib/licensing";
import { json, sameOrigin } from "@/lib/room-gate";

// POST: mark an error fixed. CEO and CTO only (the API checks).
export async function POST(req: NextRequest, { params }: { params: Promise<{ fp: string }> }) {
  if (!sameOrigin(req)) return json(403, { error: "forbidden" });
  const s = await session();
  if (!s) return json(401, { error: "Sign in first" });
  const { fp } = await params;
  if (!/^[0-9a-f]{24}$/.test(fp)) return json(404, { error: "not found" });
  const r = await accountApi("POST", `/v1/me/exec/errors/${fp}/resolve`, {}, s);
  return json(r.status, r.body ?? {});
}
