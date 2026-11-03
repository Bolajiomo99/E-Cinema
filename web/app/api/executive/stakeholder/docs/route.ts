import type { NextRequest } from "next/server";
import { randomUUID } from "node:crypto";
import { accountApi } from "@/lib/auth";
import { session } from "@/lib/licensing";
import { json, sameOrigin } from "@/lib/room-gate";
import { mediaEnabled, putRoomObject } from "@/lib/media";

// POST multipart { file }: share a PDF (up to 20 MB) with stakeholders. The CEO only: the API
// checks before anything is stored.
export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return json(403, { error: "forbidden" });
  const s = await session();
  if (!s) return json(401, { error: "Sign in first" });
  if (!mediaEnabled) return json(503, { error: "File storage is not switched on here" });
  const form = await req.formData().catch(() => null);
  const f = form?.get("file");
  if (!(f instanceof File)) return json(400, { error: "Choose a PDF" });
  if (f.size > 20 << 20) return json(400, { error: "PDFs can be up to 20 MB" });
  const body = Buffer.from(await f.arrayBuffer());
  if (body.subarray(0, 5).toString() !== "%PDF-") return json(400, { error: "Only PDF files can be shared" });
  const name = (f.name || "Document.pdf").replace(/[\u0000-\u001f]/g, "").slice(0, 120);
  const key = `board/${randomUUID()}.pdf`;
  // Ask the API first so nobody but the CEO can put files in storage.
  const check = await accountApi("GET", "/v1/me/exec/stakeholder", undefined, s);
  if (check.status !== 200 || !(check.body as { canEdit?: boolean }).canEdit) return json(403, { error: "Only the CEO can share documents" });
  await putRoomObject(key, body, "application/pdf");
  const r = await accountApi("POST", "/v1/me/exec/stakeholder/docs", { name, key, bytes: body.length }, s);
  return json(r.status, r.body ?? {});
}
