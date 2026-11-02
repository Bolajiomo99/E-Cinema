import type { NextRequest } from "next/server";
import { randomUUID } from "node:crypto";
import { accountApi, currentAccount } from "@/lib/auth";
import { aiEnabled, readCertificate, session } from "@/lib/licensing";
import { mediaEnabled, putRoomObject, roomObjectLink } from "@/lib/media";
import { json, sameOrigin } from "@/lib/room-gate";
import { draftNotice } from "@/lib/leak-notice";
import { askStudio, type Turn } from "@/lib/studio-ai";
import { isStaff } from "@/lib/store";
import type { Studio } from "@/lib/studio-types";

// The studio portal (Figma 34:49 to 39:1184): onboarding, the studio's own numbers, its team,
// and the studio desk where E-Cinema staff verify new studios.
export const dynamic = "force-dynamic";

const TYPES: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "application/pdf": "pdf" };
const KEY = /^studios\/[0-9a-f-]{36}\.(jpg|png|pdf)$/;
const SLUG = /^[a-z0-9-]{1,90}$/;
const PAGES = new Set(["overview", "films", "payouts", "team", "leaks", "campaigns"]);
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const PLACES: Record<string, string> = { website: "a website", telegram: "a Telegram channel", tiktok: "TikTok", youtube: "YouTube", x: "X", instagram: "Instagram", facebook: "Facebook", whatsapp: "WhatsApp", other: "an online service" };
const KINDS: Record<string, string> = { clip: "a clip of the film", full: "the full film", screenshot: "a still from the film", other: "material from the film" };
const pass = (r: { status: number; body: unknown }) => json(r.status, r.body ?? {});
const recent = new Map<string, number[]>();

function limited(key: string, max: number) {
  const now = Date.now();
  const list = (recent.get(key) ?? []).filter((t) => now - t < 60_000);
  if (list.length >= max) return true;
  recent.set(key, [...list, now]);
  if (recent.size > 5000) recent.clear();
  return false;
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ path?: string[] }> }) {
  const p = (await params).path ?? [];
  const s = await session();
  if (!s) return json(401, { error: "Sign in first", signIn: true });
  if (!p.length) return pass(await accountApi("GET", "/v1/me/studio", undefined, s));
  if (p.length === 1 && PAGES.has(p[0])) return pass(await accountApi("GET", `/v1/me/studio/${p[0]}`, undefined, s));
  if (p[0] === "docs") {
    const r = await accountApi("GET", "/v1/me/studio", undefined, s);
    const st = (r.body as { studio: Studio | null }).studio;
    if (!st?.docsKey || !KEY.test(st.docsKey) || !mediaEnabled) return json(404, { error: "No document yet" });
    return json(200, { url: await roomObjectLink(st.docsKey) });
  }
  if (p[0] === "desk" && p[1] === "bans" && p.length === 2) {
    const me = await currentAccount();
    if (!isStaff(me?.email)) return json(403, { error: "Staff only" });
    return pass(await accountApi("GET", "/v1/studio-bans"));
  }
  if (p[0] === "desk") {
    const me = await currentAccount();
    if (!isStaff(me?.email)) return json(403, { error: "Staff only" });
    const r = await accountApi("GET", "/v1/studios/applications");
    if (r.status !== 200) return pass(r);
    const list = (r.body as { studios: Studio[] }).studios;
    return json(200, { studios: await Promise.all(list.map(async (x) => ({ ...x, doc: mediaEnabled && KEY.test(x.docsKey) ? await roomObjectLink(x.docsKey) : undefined }))) });
  }
  return json(404, { error: "Not found" });
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ path?: string[] }> }) {
  if (!sameOrigin(req)) return json(403, { error: "forbidden" });
  const p = (await params).path ?? [];
  const s = await session();
  if (!s) return json(401, { error: "Sign in first", signIn: true });
  const body = await req.json().catch(() => ({}));
  if (!p.length) return pass(await accountApi("PUT", "/v1/me/studio", body, s));
  if (p.length === 1 && ["payout", "rights", "team"].includes(p[0])) return pass(await accountApi("PUT", `/v1/me/studio/${p[0]}`, body, s));
  if (p.length === 2 && p[0] === "leaks" && ID.test(p[1])) return pass(await accountApi("PUT", `/v1/me/studio/leaks/${p[1]}`, body, s));
  if (p.length === 2 && p[0] === "campaigns" && ID.test(p[1])) return pass(await accountApi("PUT", `/v1/me/studio/campaigns/${p[1]}`, { costCents: Math.round(Number(body.costCents) || 0) }, s));
  return json(404, { error: "Not found" });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ path?: string[] }> }) {
  if (!sameOrigin(req)) return json(403, { error: "forbidden" });
  const p = (await params).path ?? [];
  const s = await session();
  if (!s) return json(401, { error: "Sign in first", signIn: true });

  // Studio AI (Figma 39:1345): a question about the studio's own numbers.
  if (p.length === 1 && p[0] === "ai") {
    if (limited(s + ":ai", 10)) return json(429, { error: "Slow down: Studio AI takes 10 questions a minute" });
    const cur = await accountApi("GET", "/v1/me/studio", undefined, s);
    const st = cur.status === 200 ? (cur.body as { studio: Studio | null }).studio : null;
    if (!st || st.status !== "verified") return json(404, { error: "Not found" });
    const body = await req.json().catch(() => ({}));
    const turns = (Array.isArray(body.messages) ? (body.messages as Record<string, unknown>[]) : []).slice(-12)
      .map((t) => ({ role: t.role === "assistant" ? "assistant" : "user", text: String(t.text ?? "").trim().slice(0, 2000) }) as Turn).filter((t) => t.text);
    while (turns.length && turns[0].role !== "user") turns.shift();
    if (!turns.length || turns[turns.length - 1].role !== "user") return json(400, { error: "Ask a question" });
    const today = new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Lagos", dateStyle: "full" }).format(new Date());
    try {
      return json(200, await askStudio(s, st.name, st.role ?? "viewer", turns, today));
    } catch (e) {
      if ((e as Error).message === "off") return json(503, { error: "Studio AI is not switched on yet." });
      console.error("studio ai", (e as Error).message);
      return json(502, { error: "Studio AI did not answer. Try again" });
    }
  }

  // The company certificate: stored privately, then read by AI against what the studio typed.
  if (p[0] === "docs") {
    if (limited(s, 10)) return json(429, { error: "Slow down: too many uploads" });
    if (!mediaEnabled) return json(503, { error: "Uploads are paused right now" });
    const cur = await accountApi("GET", "/v1/me/studio", undefined, s);
    const st = (cur.body as { studio: Studio | null }).studio;
    if (!st) return json(400, { error: "Save your studio details first" });
    const form = await req.formData().catch(() => null);
    const file = form?.get("file");
    if (!(file instanceof File)) return json(400, { error: "Choose a file" });
    const type = file.type.split(";")[0];
    if (!TYPES[type]) return json(400, { error: "Use a PDF, JPG or PNG" });
    if (file.size === 0 || file.size > 12 << 20) return json(400, { error: "That file is too big (up to 12 MB)" });
    const buf = Buffer.from(await file.arrayBuffer());
    const head = buf.subarray(0, 8).toString("latin1");
    const real = type === "application/pdf" ? head.startsWith("%PDF") : /^\xff\xd8|^\x89PNG/.test(head);
    if (!real) return json(400, { error: "That file does not look like what it says it is" });
    const key = `studios/${randomUUID()}.${TYPES[type]}`;
    await putRoomObject(key, buf, type);
    let ok = false, note = "Uploaded. Our studio team reads it before your first premiere.";
    if (aiEnabled()) {
      try {
        const d = await readCertificate(buf, type, st.legalName || st.name, st.regNumber);
        ok = d.isRegistration && d.matches;
        note = !d.isRegistration ? "This does not look like a registration certificate. You can upload another." : ok ? `Checked by AI: ${d.company}, ${d.number}` : `AI check: ${d.note}`;
      } catch (err) {
        console.error("studio certificate check failed", (err as Error).message);
      }
    }
    const r = await accountApi("PUT", "/v1/me/studio/docs", { key, ok }, s);
    return r.status === 200 ? json(200, { ...(r.body as object), note }) : pass(r);
  }
  if (p.length === 1 && (p[0] === "terms" || p[0] === "submit")) return pass(await accountApi("POST", `/v1/me/studio/${p[0]}`, {}, s));
  const body = await req.json().catch(() => ({}));
  if (p[0] === "team" && p[1] === "remove") return pass(await accountApi("POST", "/v1/me/studio/team/remove", body, s));
  if (p.length === 1 && p[0] === "campaigns") {
    if (limited(s + ":cmp", 20)) return json(429, { error: "Slow down: too many campaigns in a minute" });
    return pass(await accountApi("POST", "/v1/me/studio/campaigns", { showtimeId: String(body.showtimeId ?? ""), name: String(body.name ?? ""), channel: String(body.channel ?? ""), costCents: Math.round(Number(body.costCents) || 0) }, s));
  }
  if (p.length === 1 && p[0] === "leaks") {
    if (limited(s + ":leak", 20)) return json(429, { error: "Slow down: too many reports in a minute" });
    return pass(await accountApi("POST", "/v1/me/studio/leaks", body, s));
  }
  // Claude drafts a takedown notice; it is saved on the report for the studio to edit and send.
  if (p.length === 3 && p[0] === "leaks" && ID.test(p[1]) && p[2] === "notice") {
    if (limited(s + ":notice", 6)) return json(429, { error: "Slow down: try again in a minute" });
    const [mine, list] = await Promise.all([accountApi("GET", "/v1/me/studio", undefined, s), accountApi("GET", "/v1/me/studio/leaks", undefined, s)]);
    if (list.status !== 200) return pass(list);
    const st = (mine.body as { studio: Studio | null }).studio;
    const l = (list.body as { leaks: { id: string; film: string; link: string; place: string; kind: string; what: string; createdAt: string }[] }).leaks.find((x) => x.id === p[1]);
    if (!st || !l) return json(404, { error: "No such leak report" });
    let text: string | null = null;
    try {
      text = await draftNotice({
        rightsHolder: st.legalName || st.name, country: st.regCountry, contact: st.payoutEmail || "[your email]", film: l.film || "[film title]", link: l.link,
        place: PLACES[l.place] ?? l.place, kind: KINDS[l.kind] ?? l.kind, what: l.what, date: new Date().toISOString().slice(0, 10),
      });
    } catch (err) {
      console.error("takedown notice failed", (err as Error).message);
      return json(502, { error: "Studio AI could not write the notice just now. Try again." });
    }
    if (!text) return json(503, { error: "Studio AI is off right now. Write the notice yourself below." });
    return pass(await accountApi("PUT", `/v1/me/studio/leaks/${p[1]}`, { notice: text }, s));
  }
  if (p.length === 3 && p[0] === "desk" && p[1] === "bans" && ID.test(p[2])) {
    const me = await currentAccount();
    if (!isStaff(me?.email)) return json(403, { error: "Staff only" });
    return pass(await accountApi("POST", `/v1/studio-bans/${p[2]}`, body));
  }

  if (p[0] === "desk" && SLUG.test(p[1] ?? "")) {
    const me = await currentAccount();
    if (!isStaff(me?.email)) return json(403, { error: "Staff only" });
    return pass(await accountApi("POST", `/v1/studios/${p[1]}/review`, body));
  }
  return json(404, { error: "Not found" });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ path?: string[] }> }) {
  if (!sameOrigin(req)) return json(403, { error: "forbidden" });
  const p = (await params).path ?? [];
  const s = await session();
  if (!s) return json(401, { error: "Sign in first", signIn: true });
  if (p.length === 2 && p[0] === "campaigns" && ID.test(p[1])) return pass(await accountApi("DELETE", `/v1/me/studio/campaigns/${p[1]}`, undefined, s));
  return json(404, { error: "Not found" });
}
