import type { NextRequest } from "next/server";
import { randomUUID } from "node:crypto";
import { session } from "@/lib/licensing";
import { json, sameOrigin } from "@/lib/room-gate";
import { execCanAdd } from "@/lib/exec";
import { mediaEnabled, putRoomObject } from "@/lib/media";

// POST: upload one product photo (JPEG, PNG or WebP, up to 5 MB). Returns its shop URL.
const TYPES: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

function sniff(b: Buffer): string | null {
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (b.subarray(0, 4).toString() === "RIFF" && b.subarray(8, 12).toString() === "WEBP") return "image/webp";
  return null;
}

export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return json(403, { error: "forbidden" });
  const s = await session();
  if (!s) return json(401, { error: "Sign in first" });
  if (!(await execCanAdd(s))) return json(403, { error: "You cannot add products" });
  if (!mediaEnabled) return json(503, { error: "Photo storage is not switched on here" });
  const form = await req.formData().catch(() => null);
  const f = form?.get("photo");
  if (!(f instanceof File)) return json(400, { error: "Choose a photo" });
  if (f.size > 5 << 20) return json(400, { error: "Photos can be up to 5 MB" });
  const body = Buffer.from(await f.arrayBuffer());
  const type = sniff(body);
  if (!type) return json(400, { error: "Use a JPEG, PNG or WebP photo" });
  const key = `${randomUUID()}.${TYPES[type]}`;
  await putRoomObject(`shop/${key}`, body, type);
  return json(200, { url: `/api/shop/photo/${key}` });
}
