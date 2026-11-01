import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { accountApi } from "@/lib/auth";
import { mediaEnabled, putRoomObject, roomObjectLink } from "@/lib/media";
import { json, roomGate, sameOrigin } from "@/lib/room-gate";
import { aiEnabled, snackCritic, transcribe, transcribeEnabled } from "@/lib/room-chat";

// Voice notes, photos and files in the watch room (Figma 17:562). Uploads go to private
// storage; viewers get them back through GET, which checks the ticket and hands out a short link.
export const dynamic = "force-dynamic";

const IMAGE = new Set(["image/jpeg", "image/png", "image/webp"]);
const AUDIO = /^audio\/(webm|ogg|mp4|mpeg|aac|x-m4a)(;.*)?$/;
const LIMIT = { voice: 4 << 20, image: 5 << 20, file: 10 << 20 };
const recent = new Map<string, number[]>();

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!sameOrigin(req)) return json(403, { error: "forbidden" });
  const g = await roomGate((await params).id);
  if (g instanceof NextResponse) return g;
  if (!mediaEnabled) return json(503, { error: "Sharing files is paused right now" });

  // At most 10 uploads a minute per viewer.
  const now = Date.now();
  const mine = (recent.get(g.accountId) ?? []).filter((t) => now - t < 60_000);
  if (mine.length >= 10) return json(429, { error: "Slow down: too many uploads" });
  recent.set(g.accountId, [...mine, now]);

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  const kind = String(form?.get("kind") ?? "");
  const scope = form?.get("scope") === "room" ? "room" : "world";
  if (!(file instanceof File) || !(kind in LIMIT)) return json(400, { error: "Choose a file to share" });
  const k = kind as keyof typeof LIMIT;
  if (file.size === 0 || file.size > LIMIT[k]) return json(400, { error: `That file is too big (up to ${LIMIT[k] >> 20} MB)` });
  const type = file.type;
  if (k === "voice" && !AUDIO.test(type)) return json(400, { error: "Voice notes must be audio" });
  if (k === "image" && !IMAGE.has(type)) return json(400, { error: "Photos must be JPG, PNG or WebP" });
  if (k === "file" && type !== "application/pdf") return json(400, { error: "Only PDF files can be shared" });

  const buf = Buffer.from(await file.arrayBuffer());
  // Check the bytes, not just the browser's label.
  const magic = buf.subarray(0, 12).toString("latin1");
  const looksRight = k === "file" ? magic.startsWith("%PDF") : k === "image" ? /^\xff\xd8|^\x89PNG|^RIFF[^]{4}WEBP/.test(magic) : true;
  if (!looksRight) return json(400, { error: "That file does not look like what it says" });

  const ext = k === "voice" ? (type.includes("mp4") || type.includes("m4a") ? "m4a" : type.includes("ogg") ? "ogg" : "webm") : k === "file" ? "pdf" : type.split("/")[1];
  const key = `rooms/${g.s.id}/${randomUUID()}.${ext}`;
  const seconds = Math.max(1, Math.min(300, Math.round(Number(form?.get("seconds")) || 1)));
  const media: Record<string, unknown> = { key, type: type.split(";")[0], size: buf.length };
  let body = "";
  if (k === "voice") {
    media.seconds = seconds;
    if (transcribeEnabled()) {
      body = await transcribe(buf, type.split(";")[0]).catch((err) => {
        console.error("voice transcript failed", (err as Error).message);
        return "";
      });
      if (body) media.transcript = true;
    }
    body ||= "Voice note";
  } else if (k === "image") {
    body = String(form?.get("caption") ?? "").trim().slice(0, 500) || "Photo";
    if (aiEnabled()) {
      const critic = await snackCritic(buf, type as "image/jpeg").catch(() => null);
      if (critic) media.critic = { score: critic.score, line: critic.line };
    }
  } else {
    const name = file.name.replace(/[^\p{L}\p{N} ._()-]/gu, "").slice(0, 80) || "file.pdf";
    media.name = name;
    body = name;
  }

  // Store the file before anyone is told about it. The API then spends talk time (refusing a free
  // member who has none left) and sends the message to the room.
  await putRoomObject(key, buf, type.split(";")[0]);
  const r = await accountApi("POST", `/v1/internal/rooms/${g.s.id}/media`, { accountId: g.accountId, scope, kind: k, body, media, seconds });
  return json(r.status, r.body);
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const id = (await params).id;
  const key = req.nextUrl.searchParams.get("key") ?? "";
  if (!key.startsWith(`rooms/${id}/`) || !/^rooms\/[a-z0-9-]+\/[0-9a-f-]{36}\.(webm|ogg|m4a|jpeg|png|webp|pdf)$/.test(key)) return json(404, { error: "Not found" });
  const g = await roomGate(id);
  if (g instanceof NextResponse) return g;
  if (!mediaEnabled) return json(503, { error: "Unavailable" });
  return NextResponse.redirect(await roomObjectLink(key), { status: 302, headers: { "Cache-Control": "private, no-store" } });
}
