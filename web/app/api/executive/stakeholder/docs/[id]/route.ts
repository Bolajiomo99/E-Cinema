import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { accountApi } from "@/lib/auth";
import { session } from "@/lib/licensing";
import { json, sameOrigin } from "@/lib/room-gate";
import { mediaEnabled, roomObjectLink } from "@/lib/media";

const ID = /^[0-9a-f-]{36}$/;

// GET: open a shared document through a short-lived link, after the API checks the reader.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const s = await session();
  if (!s) return json(401, { error: "Sign in first" });
  const { id } = await params;
  if (!ID.test(id)) return json(404, { error: "not found" });
  const r = await accountApi("GET", `/v1/me/exec/stakeholder/docs/${id}`, undefined, s);
  if (r.status !== 200) return json(r.status, r.body ?? {});
  if (!mediaEnabled) return json(503, { error: "File storage is not switched on here" });
  const { key } = r.body as { key: string };
  return NextResponse.redirect(await roomObjectLink(key), { status: 302, headers: { "Cache-Control": "no-store" } });
}

// DELETE: stop sharing a document. The CEO only (the API checks).
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!sameOrigin(req)) return json(403, { error: "forbidden" });
  const s = await session();
  if (!s) return json(401, { error: "Sign in first" });
  const { id } = await params;
  if (!ID.test(id)) return json(404, { error: "not found" });
  const r = await accountApi("DELETE", `/v1/me/exec/stakeholder/docs/${id}`, undefined, s);
  return json(r.status, r.body ?? {});
}
