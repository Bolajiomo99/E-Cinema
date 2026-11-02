import type { NextRequest } from "next/server";
import { accountApi } from "@/lib/auth";
import { session } from "@/lib/licensing";
import { json, sameOrigin } from "@/lib/room-gate";

// POST { title, kind, severity, note }: log a security incident. CEO and CTO only (the API checks).
export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return json(403, { error: "forbidden" });
  const s = await session();
  if (!s) return json(401, { error: "Sign in first" });
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  const r = await accountApi("POST", "/v1/me/exec/security/incidents", { title: str(b.title), kind: str(b.kind), severity: str(b.severity), note: str(b.note) }, s);
  return json(r.status, r.body ?? {});
}
