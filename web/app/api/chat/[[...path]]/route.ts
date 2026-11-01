import { randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { accountApi, SESSION_COOKIE } from "@/lib/auth";
import { aiSpam, chatAiEnabled, ruleSpam, translateMessage } from "@/lib/chat";
import { mediaEnabled, putRoomObject, roomObjectLink } from "@/lib/media";
import { transcribe, transcribeEnabled } from "@/lib/room-chat";
import { json, sameOrigin } from "@/lib/room-gate";

// Messages (Figma 32:798, 95:2163). A strict map from page actions to the Go API; files go to
// private storage under chat/<conversation>/ and come back through short signed links.
export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ path?: string[] }> };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const NUM = /^[1-9][0-9]{0,18}$/;
const IMAGE = new Set(["image/jpeg", "image/png", "image/webp"]);
const AUDIO = /^audio\/(webm|ogg|mp4|x-m4a)(;.*)?$/;
const LIMIT = { voice: 5 << 20, photo: 8 << 20 };
const uploads = new Map<string, number[]>();

async function session() {
  return (await cookies()).get(SESSION_COOKIE)?.value;
}
const relay = (r: { status: number; body: unknown }) => json(r.status, r.body ?? {});
const body = async (req: Request) => (await req.json().catch(() => ({}))) as Record<string, unknown>;

export async function GET(req: NextRequest, { params }: Ctx) {
  const s = await session();
  if (!s) return json(401, { error: "Sign in first" });
  const p = (await params).path ?? [];
  const q = req.nextUrl.searchParams;
  if (p.length === 0) {
    const f = q.get("filter") ?? "";
    if (!/^(|all|friends|groups)$/.test(f)) return json(400, { error: "bad filter" });
    return relay(await accountApi("GET", `/v1/me/chat?filter=${f}`, undefined, s));
  }
  if (p.length === 1 && p[0] === "unread") return relay(await accountApi("GET", "/v1/me/chat/unread", undefined, s));
  if (p.length === 1 && p[0] === "friends") return relay(await accountApi("GET", "/v1/me/friends", undefined, s));
  if (p.length === 1 && p[0] === "requests") return relay(await accountApi("GET", "/v1/me/friends/requests", undefined, s));
  if (p.length === 1 && p[0] === "search") return relay(await accountApi("GET", `/v1/me/chat/search?q=${encodeURIComponent((q.get("q") ?? "").slice(0, 80))}`, undefined, s));
  if (p.length === 1 && p[0] === "pass") {
    const r = await accountApi("POST", "/v1/me/chat/pass", {}, s);
    if (r.status !== 200) return relay(r);
    return json(200, { ...(r.body as object), ws: (process.env.API_URL ?? "").replace(/^http/, "ws") });
  }
  if (p.length === 1 && p[0] === "media") {
    const key = q.get("key") ?? "";
    if (!/^chat\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.(webm|ogg|m4a|jpg|png|webp)$/.test(key)) return json(404, { error: "Not found" });
    const r = await accountApi("GET", `/v1/me/chat-media?key=${encodeURIComponent(key)}`, undefined, s);
    if (r.status !== 204) return relay(r);
    if (!mediaEnabled) return json(503, { error: "Unavailable" });
    return NextResponse.redirect(await roomObjectLink(key), { status: 302, headers: { "Cache-Control": "private, no-store" } });
  }
  if (p.length === 2 && p[0] === "c" && UUID.test(p[1])) {
    const before = q.get("before") ?? "";
    if (before && !NUM.test(before)) return json(400, { error: "bad cursor" });
    return relay(await accountApi("GET", `/v1/me/chat/${p[1]}${before ? `?before=${before}` : ""}`, undefined, s));
  }
  return json(404, { error: "not found" });
}

export async function POST(req: NextRequest, { params }: Ctx) {
  if (!sameOrigin(req)) return json(403, { error: "forbidden" });
  const s = await session();
  if (!s) return json(401, { error: "Sign in first" });
  const p = (await params).path ?? [];

  if (p.length === 1 && p[0] === "requests") {
    const b = await body(req);
    const to = String(b.to ?? ""), note = String(b.note ?? "").trim().slice(0, 140);
    if (!UUID.test(to)) return json(400, { error: "Choose someone to add" });
    const spam = ruleSpam(note) ? "rules" : (await aiSpam(note)) ? "ai" : "";
    return relay(await accountApi("POST", "/v1/me/friends/requests", { to, note, spam }, s));
  }
  if (p.length === 2 && p[0] === "requests" && UUID.test(p[1])) {
    const b = await body(req);
    return relay(await accountApi("POST", `/v1/me/friends/requests/${p[1]}`, { action: b.action, reason: b.reason ?? "" }, s));
  }
  if (p.length === 1 && p[0] === "blocks") {
    const b = await body(req);
    if (!UUID.test(String(b.id ?? ""))) return json(400, { error: "bad id" });
    return relay(await accountApi("POST", "/v1/me/blocks", { id: b.id }, s));
  }
  if (p.length === 1 && p[0] === "dm") {
    const b = await body(req);
    if (!UUID.test(String(b.friendId ?? ""))) return json(400, { error: "bad id" });
    return relay(await accountApi("POST", "/v1/me/chat/dm", { friendId: b.friendId }, s));
  }
  if (p.length === 1 && p[0] === "groups") {
    const b = await body(req);
    const members = Array.isArray(b.members) ? b.members.map(String).filter((m) => UUID.test(m)).slice(0, 49) : [];
    return relay(await accountApi("POST", "/v1/me/chat/groups", { name: String(b.name ?? "").slice(0, 40), members }, s));
  }
  if (p.length === 3 && p[0] === "c" && UUID.test(p[1])) {
    const conv = p[1];
    switch (p[2]) {
      case "messages": {
        const b = await body(req);
        return relay(await accountApi("POST", `/v1/me/chat/${conv}/messages`, {
          kind: b.kind, body: String(b.body ?? "").slice(0, 2000), mediaKey: b.mediaKey ?? "", durationMs: Number(b.durationMs) || 0,
          transcript: String(b.transcript ?? "").slice(0, 4000), partyCode: b.partyCode ?? "",
        }, s));
      }
      case "read": {
        const b = await body(req);
        return relay(await accountApi("POST", `/v1/me/chat/${conv}/read`, { upto: Number(b.upto) || 0 }, s));
      }
      case "members": {
        const b = await body(req);
        const members = Array.isArray(b.members) ? b.members.map(String).filter((m) => UUID.test(m)).slice(0, 49) : [];
        return relay(await accountApi("POST", `/v1/me/chat/${conv}/members`, { members }, s));
      }
      case "leave":
        return relay(await accountApi("DELETE", `/v1/me/chat/${conv}/members/me`, undefined, s));
      case "translate": {
        const b = await body(req);
        return relay(await accountApi("PUT", `/v1/me/chat/${conv}/translate`, { on: b.on === true }, s));
      }
      case "upload":
        return upload(req, s, conv);
    }
  }
  if (p.length === 3 && p[0] === "m" && NUM.test(p[1])) {
    const b = await body(req);
    if (p[2] === "report") return relay(await accountApi("POST", `/v1/me/chat-messages/${p[1]}/report`, { reason: b.reason }, s));
    if (p[2] === "translate") {
      const lang = String(b.lang ?? "");
      if (!/^[a-z]{2,3}(-[A-Za-z]{2,4})?$/.test(lang)) return json(400, { error: "bad language" });
      const got = await accountApi("GET", `/v1/me/chat-messages/${p[1]}/translation?lang=${lang}`, undefined, s);
      if (got.status !== 200) return relay(got);
      const t = got.body as { source: string; body: string };
      if (t.body) return json(200, { body: t.body });
      if (!t.source.trim()) return json(200, { body: "" });
      if (!chatAiEnabled()) return json(503, { error: "Translation is paused right now" });
      const out = await translateMessage(t.source, lang).catch(() => "");
      if (!out) return json(503, { error: "Translation is paused right now" });
      await accountApi("PUT", `/v1/me/chat-messages/${p[1]}/translation`, { lang, body: out }, s);
      return json(200, { body: out });
    }
  }
  return json(404, { error: "not found" });
}

export async function DELETE(req: NextRequest, { params }: Ctx) {
  if (!sameOrigin(req)) return json(403, { error: "forbidden" });
  const s = await session();
  if (!s) return json(401, { error: "Sign in first" });
  const p = (await params).path ?? [];
  if (p.length === 2 && p[0] === "friends" && UUID.test(p[1])) return relay(await accountApi("DELETE", `/v1/me/friends/${p[1]}`, undefined, s));
  return json(404, { error: "not found" });
}

// A voice note or photo for one chat. The bytes are checked, stored, and (for voice) transcribed;
// the page then sends the message that points at them.
async function upload(req: NextRequest, s: string, conv: string) {
  if (!mediaEnabled) return json(503, { error: "Sharing files is paused right now" });
  const ok = await accountApi("GET", `/v1/me/chat/${conv}/can-upload`, undefined, s);
  if (ok.status !== 204) return relay(ok);
  const now = Date.now();
  const mine = (uploads.get(s) ?? []).filter((t) => now - t < 60_000);
  if (mine.length >= 12) return json(429, { error: "Slow down: too many uploads" });
  uploads.set(s, [...mine, now]);

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  const kind = String(form?.get("kind") ?? "");
  if (!(file instanceof File) || (kind !== "voice" && kind !== "photo")) return json(400, { error: "Choose a file to send" });
  if (file.size === 0 || file.size > LIMIT[kind]) return json(400, { error: `That file is too big (up to ${LIMIT[kind] >> 20} MB)` });
  const type = file.type.split(";")[0];
  if (kind === "voice" && !AUDIO.test(file.type)) return json(400, { error: "Voice notes must be audio" });
  if (kind === "photo" && !IMAGE.has(type)) return json(400, { error: "Photos must be JPG, PNG or WebP" });
  const buf = Buffer.from(await file.arrayBuffer());
  const magic = buf.subarray(0, 12).toString("latin1");
  if (kind === "photo" && !/^\xff\xd8|^\x89PNG|^RIFF[^]{4}WEBP/.test(magic)) return json(400, { error: "That file does not look like a photo" });
  if (kind === "voice" && !/^\x1aE\xdf\xa3|^OggS|^[^]{4}ftyp/.test(magic)) return json(400, { error: "That file does not look like a voice note" });
  const ext = kind === "voice" ? (type.includes("ogg") ? "ogg" : type.includes("mp4") || type.includes("m4a") ? "m4a" : "webm") : type === "image/jpeg" ? "jpg" : type.split("/")[1];
  const key = `chat/${conv}/${randomUUID()}.${ext}`;
  await putRoomObject(key, buf, type);
  let transcript = "";
  if (kind === "voice" && transcribeEnabled()) {
    transcript = await transcribe(buf, type).catch((err) => {
      console.error("chat transcript failed", (err as Error).message);
      return "";
    });
  }
  return json(200, { key, transcript });
}
