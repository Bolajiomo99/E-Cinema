import { randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { accountApi, SESSION_COOKIE } from "@/lib/auth";
import { chatAiEnabled, translatePost } from "@/lib/chat";
import { mediaEnabled, putRoomObject, roomObjectLink } from "@/lib/media";
import { json, sameOrigin } from "@/lib/room-gate";

// Community (Figma 32:951, 96:1566): a strict map from page actions to the Go API. Photos go to
// private storage under posts/ and come back through short signed links for people who can see
// the post.
export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ path?: string[] }> };
const NUM = /^[1-9][0-9]{0,18}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const WHO = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[a-z0-9._]{3,20})$/;
const SLUG = /^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$/;
const IMAGE = new Set(["image/jpeg", "image/png", "image/webp"]);
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
  if (p.length === 1 && p[0] === "groups") return relay(await accountApi("GET", "/v1/me/communities", undefined, s));
  if (p.length === 2 && p[0] === "groups" && SLUG.test(p[1])) return relay(await accountApi("GET", `/v1/me/communities/${p[1]}`, undefined, s));
  if (p.length === 3 && p[0] === "groups" && SLUG.test(p[1]) && p[2] === "members") return relay(await accountApi("GET", `/v1/me/communities/${p[1]}/members`, undefined, s));
  if (p.length === 2 && p[0] === "people" && UUID.test(p[1])) return relay(await accountApi("GET", `/v1/me/people/${p[1]}`, undefined, s));
  // Profile tabs (Figma 32:1060): {who} is an account id or a username.
  if (p.length === 3 && p[0] === "people" && WHO.test(p[1]) && ["page", "watched", "reviews", "badges"].includes(p[2])) return relay(await accountApi("GET", `/v1/me/people/${p[1]}/${p[2]}`, undefined, s));
  if (p.length === 1 && p[0] === "side") return relay(await accountApi("GET", "/v1/me/community-side", undefined, s));
  if (p.length === 1 && p[0] === "posts") {
    const out = new URLSearchParams();
    const community = q.get("community") ?? "", author = q.get("author") ?? "", tag = q.get("tag") ?? "", before = q.get("before") ?? "";
    if (community && !SLUG.test(community)) return json(400, { error: "bad group" });
    if (author && !UUID.test(author)) return json(400, { error: "bad author" });
    if (tag && !/^[\p{L}\p{M}\p{N}_]{2,40}$/u.test(tag)) return json(400, { error: "bad tag" });
    if (before && !NUM.test(before)) return json(400, { error: "bad cursor" });
    if (community) out.set("community", community);
    if (author) out.set("author", author);
    if (tag) out.set("tag", tag);
    if (before) out.set("before", before);
    if (q.get("following") === "1") out.set("following", "1");
    return relay(await accountApi("GET", `/v1/me/posts?${out}`, undefined, s));
  }
  if (p.length === 2 && p[0] === "posts" && NUM.test(p[1])) return relay(await accountApi("GET", `/v1/me/posts/${p[1]}`, undefined, s));
  if (p.length === 3 && p[0] === "posts" && NUM.test(p[1]) && p[2] === "comments") return relay(await accountApi("GET", `/v1/me/posts/${p[1]}/comments`, undefined, s));
  if (p.length === 3 && p[0] === "posts" && NUM.test(p[1]) && p[2] === "photo") {
    const r = await accountApi("GET", `/v1/me/posts/${p[1]}`, undefined, s);
    if (r.status !== 200) return relay(r);
    const key = (r.body as { mediaKey?: string }).mediaKey ?? "";
    if (!/^posts\/[0-9a-f-]{36}\.(jpg|png|webp)$/.test(key)) return json(404, { error: "Not found" });
    if (!mediaEnabled) return json(503, { error: "Unavailable" });
    return NextResponse.redirect(await roomObjectLink(key), { status: 302, headers: { "Cache-Control": "private, max-age=300" } });
  }
  return json(404, { error: "not found" });
}

export async function POST(req: NextRequest, { params }: Ctx) {
  if (!sameOrigin(req)) return json(403, { error: "forbidden" });
  const s = await session();
  if (!s) return json(401, { error: "Sign in first" });
  const p = (await params).path ?? [];

  if (p.length === 1 && p[0] === "groups") {
    const b = await body(req);
    return relay(await accountApi("POST", "/v1/me/communities", {
      name: String(b.name ?? "").slice(0, 60), about: String(b.about ?? "").slice(0, 400), visibility: b.visibility === "private" ? "private" : "public",
    }, s));
  }
  if (p.length === 3 && p[0] === "groups" && SLUG.test(p[1])) {
    if (p[2] === "join") return relay(await accountApi("POST", `/v1/me/communities/${p[1]}/members`, {}, s));
    if (p[2] === "leave") return relay(await accountApi("DELETE", `/v1/me/communities/${p[1]}/members/me`, undefined, s));
    if (p[2] === "party") {
      const b = await body(req);
      const code = String(b.code ?? "");
      if (!/^[a-z0-9-]{6,40}$/.test(code)) return json(400, { error: "Choose one of your parties" });
      return relay(await accountApi("PUT", `/v1/me/communities/${p[1]}/parties/${code}`, { on: b.on !== false }, s));
    }
  }
  if (p.length === 1 && p[0] === "photo") return upload(req, s);
  if (p.length === 1 && p[0] === "posts") {
    const b = await body(req);
    const options = Array.isArray(b.options) ? b.options.map((o) => String(o).slice(0, 80)).slice(0, 6) : [];
    const community = String(b.community ?? "");
    if (community && !SLUG.test(community)) return json(400, { error: "bad group" });
    const text = String(b.body ?? "").slice(0, 2000);
    const r = await accountApi("POST", "/v1/me/posts", {
      community, kind: b.kind, body: text, lang: "", mediaKey: String(b.mediaKey ?? ""),
      showtimeId: /^[a-z0-9-]{1,80}$/.test(String(b.showtimeId ?? "")) ? b.showtimeId : "", options, pollHours: Number(b.pollHours) || 0,
    }, s);
    // In the background, learn the post's language (and keep a copy in the author's own), so
    // readers who share that language never see a "Translate" button.
    const id = (r.body as { id?: number })?.id;
    if (r.status === 201 && id && text.trim() && chatAiEnabled()) void detect(s, id, text);
    return relay(r);
  }
  if (p.length === 1 && p[0] === "profile") {
    const b = await body(req);
    const spoken = Array.isArray(b.spoken) ? b.spoken.map((x) => String(x).trim().slice(0, 24)).filter(Boolean).slice(0, 6) : [];
    return relay(await accountApi("PUT", "/v1/me/public-profile", { city: String(b.city ?? "").slice(0, 40), interests: String(b.interests ?? "").slice(0, 80), spoken }, s));
  }
  if (p.length === 5 && p[0] === "people" && UUID.test(p[1]) && p[2] === "reviews" && /^[a-z0-9-]{1,80}$/.test(p[3]) && p[4] === "like") {
    const b = await body(req);
    return relay(await accountApi("PUT", `/v1/me/people/${p[1]}/reviews/${p[3]}/like`, { on: b.on === true }, s));
  }
  if (p.length === 1 && p[0] === "follow") {
    const b = await body(req);
    if (!UUID.test(String(b.id ?? ""))) return json(400, { error: "bad id" });
    return relay(await accountApi("PUT", `/v1/me/follows/${b.id}`, { on: b.on === true }, s));
  }
  if (p.length === 3 && p[0] === "posts" && NUM.test(p[1])) {
    const id = p[1];
    const b = await body(req);
    switch (p[2]) {
      case "like": return relay(await accountApi("PUT", `/v1/me/posts/${id}/like`, { on: b.on === true }, s));
      case "pin": return relay(await accountApi("PUT", `/v1/me/posts/${id}/pin`, { on: b.on === true }, s));
      case "vote": return relay(await accountApi("POST", `/v1/me/posts/${id}/vote`, { option: Number(b.option) }, s));
      case "comments": return relay(await accountApi("POST", `/v1/me/posts/${id}/comments`, { body: String(b.body ?? "").slice(0, 1000) }, s));
      case "report": return relay(await accountApi("POST", `/v1/me/posts/${id}/report`, { reason: String(b.reason ?? "other") }, s));
      case "share": return relay(await accountApi("POST", `/v1/me/posts/${id}/share`, {}, s));
      case "delete": return relay(await accountApi("DELETE", `/v1/me/posts/${id}`, undefined, s));
      case "translate": {
        const lang = String(b.lang ?? "");
        if (!/^[a-z]{2,3}$/.test(lang)) return json(400, { error: "bad language" });
        const got = await accountApi("GET", `/v1/me/posts/${id}/translation?to=${lang}`, undefined, s);
        if (got.status !== 200) return relay(got);
        const t = got.body as { body: string; lang: string; translation?: string; source?: string };
        if (t.translation !== undefined) return json(200, { body: t.translation, source: t.source || t.lang });
        if (!t.body.trim()) return json(200, { body: "", source: t.lang });
        if (!chatAiEnabled()) return json(503, { error: "Translation is paused right now" });
        const out = await translatePost(t.body, lang).catch(() => null);
        if (!out) return json(503, { error: "Translation is paused right now" });
        await accountApi("PUT", `/v1/me/posts/${id}/translation`, { lang, body: out.text, source: out.source }, s);
        return json(200, { body: out.text, source: out.source });
      }
    }
  }
  return json(404, { error: "not found" });
}

// A photo for a new post. The bytes are checked and stored; the post then points at them.
async function upload(req: NextRequest, s: string) {
  if (!mediaEnabled) return json(503, { error: "Photo posts are paused right now" });
  const me = await accountApi("GET", "/v1/me/community-side", undefined, s);
  if (me.status !== 200) return relay(me);
  const now = Date.now();
  const mine = (uploads.get(s) ?? []).filter((t) => now - t < 60_000);
  if (mine.length >= 6) return json(429, { error: "Slow down: too many uploads" });
  uploads.set(s, [...mine, now]);
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return json(400, { error: "Choose a photo" });
  const type = file.type.split(";")[0];
  if (!IMAGE.has(type)) return json(400, { error: "Photos must be JPG, PNG or WebP" });
  if (file.size === 0 || file.size > 8 << 20) return json(400, { error: "That photo is too big (up to 8 MB)" });
  const buf = Buffer.from(await file.arrayBuffer());
  if (!/^\xff\xd8|^\x89PNG|^RIFF[^]{4}WEBP/.test(buf.subarray(0, 12).toString("latin1"))) return json(400, { error: "That file does not look like a photo" });
  const key = `posts/${randomUUID()}.${type === "image/jpeg" ? "jpg" : type.split("/")[1]}`;
  await putRoomObject(key, buf, type);
  return json(200, { key });
}

async function detect(s: string, id: number, text: string) {
  try {
    const prof = await accountApi("GET", "/v1/me/profile", undefined, s);
    const lang = ((prof.body as { appLanguage?: string })?.appLanguage || "en").split("-")[0];
    if (!/^[a-z]{2,3}$/.test(lang)) return;
    const out = await translatePost(text, lang);
    if (out.source) await accountApi("PUT", `/v1/me/posts/${id}/translation`, { lang, body: out.text, source: out.source }, s);
  } catch (err) {
    console.error("post language failed", (err as Error).message);
  }
}
