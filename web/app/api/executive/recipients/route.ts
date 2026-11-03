import type { NextRequest } from "next/server";
import { accountApi } from "@/lib/auth";
import { session } from "@/lib/licensing";
import { json, sameOrigin } from "@/lib/room-gate";

// PUT: add (no id) or edit an 18+ recipient. The CEO only (the API checks).
export async function PUT(req: NextRequest) {
  if (!sameOrigin(req)) return json(403, { error: "forbidden" });
  const s = await session();
  if (!s) return json(401, { error: "Sign in first" });
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  const r = await accountApi("PUT", "/v1/me/exec/recipients", {
    id: str(b.id), kind: str(b.kind), name: str(b.name), regNumber: str(b.regNumber), country: str(b.country), city: str(b.city),
    bank: str(b.bank), accountNo: str(b.accountNo).replace(/\s/g, ""), accountName: str(b.accountName), status: str(b.status), note: str(b.note),
  }, s);
  return json(r.status, r.body ?? {});
}
