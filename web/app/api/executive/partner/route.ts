import type { NextRequest } from "next/server";
import { accountApi } from "@/lib/auth";
import { session } from "@/lib/licensing";
import { json, sameOrigin } from "@/lib/room-gate";

// PUT { email, kind, provider, summary, plan }: set a partner's deal. The CEO only (the API checks).
export async function PUT(req: NextRequest) {
  if (!sameOrigin(req)) return json(403, { error: "forbidden" });
  const s = await session();
  if (!s) return json(401, { error: "Sign in first" });
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  const plan = Array.isArray(b.plan) ? b.plan.filter((x): x is string => typeof x === "string").slice(0, 8) : [];
  const r = await accountApi("PUT", "/v1/me/exec/partner", { email: str(b.email), name: "", org: "", kind: str(b.kind), provider: str(b.provider), summary: str(b.summary), plan }, s);
  return json(r.status, r.body ?? {});
}
