import type { NextRequest } from "next/server";
import { accountApi } from "@/lib/auth";
import { session } from "@/lib/licensing";
import { json, sameOrigin } from "@/lib/room-gate";

// POST { title, kind, severity, note, showtimeId?, from?, to?, countries? }: log a security incident. An outage
// naming a screening credits a free seat to everyone who was watching (email 31). CEO and CTO only (the API checks).
export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return json(403, { error: "forbidden" });
  const s = await session();
  if (!s) return json(401, { error: "Sign in first" });
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  const when = (v: unknown) => (typeof v === "string" && !Number.isNaN(Date.parse(v)) ? new Date(v).toISOString() : undefined);
  const outage = str(b.kind) === "outage" && str(b.showtimeId) !== "";
  const countries = Array.isArray(b.countries) ? b.countries.filter((c): c is string => typeof c === "string").slice(0, 60) : [];
  const r = await accountApi("POST", "/v1/me/exec/security/incidents", {
    title: str(b.title), kind: str(b.kind), severity: str(b.severity), note: str(b.note),
    ...(outage ? { showtimeId: str(b.showtimeId), from: when(b.from), to: when(b.to), countries } : {}),
  }, s);
  return json(r.status, r.body ?? {});
}
