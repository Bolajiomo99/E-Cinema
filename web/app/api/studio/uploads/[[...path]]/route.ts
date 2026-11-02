import type { NextRequest } from "next/server";
import { accountApi } from "@/lib/auth";
import { session } from "@/lib/licensing";
import { randomUUID } from "node:crypto";
import { dropUpload, finishMultipart, mediaEnabled, objectRange, putRoomObject, roomObjectLink, signPart, startMultipart, uploadedParts } from "@/lib/media";
import { json, sameOrigin } from "@/lib/room-gate";
import { partCount, type Upload, type UploadFile } from "@/lib/studio-types";
import { inspect } from "@/lib/upload-checks";
import { refreshLive } from "@/lib/live-catalog";
import { usdRates } from "@/lib/fx";
import { marketOf, type Premiere } from "@/lib/premiere-types";
import { suggestPrices } from "@/lib/price-ai";
import { syncDubs } from "@/lib/dub-worker";
import { readMood } from "@/lib/control-ai";
import { pickClips } from "@/lib/clip-ai";

// Film uploads (Figma 35:290). The browser asks here for signed links and sends each part of
// a file straight to private storage; this route opens, resumes, finishes and checks files.
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const ID = /^[0-9a-f-]{36}$/;
const IMAGES: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
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

type Ctx = { params: Promise<{ path?: string[] }> };

async function start(req: NextRequest, ctx: Ctx, write: boolean) {
  if (write && !sameOrigin(req)) return { error: json(403, { error: "forbidden" }) };
  const p = (await ctx.params).path ?? [];
  if ((p[0] && !ID.test(p[0])) || (p[1] === "files" && p[2] && !ID.test(p[2]))) return { error: json(404, { error: "Not found" }) };
  const s = await session();
  if (!s) return { error: json(401, { error: "Sign in first", signIn: true }) };
  return { p, s };
}

async function fileOf(s: string, upload: string, file: string, write: boolean) {
  if (!ID.test(upload) || !ID.test(file)) return null;
  const r = await accountApi("GET", `/v1/me/studio/uploads/${upload}/files/${file}${write ? "?write=1" : ""}`, undefined, s);
  return r.status === 200 ? { file: (r.body as { file: UploadFile }).file } : { error: pass(r) };
}

// Whether this person may change the draft, asked before anything is stored or deleted.
// The file lookup checks the edit role first, so a made-up file id answers 403 or 404.
async function mayWrite(s: string, upload: string) {
  const r = await accountApi("GET", `/v1/me/studio/uploads/${upload}/files/00000000-0000-4000-8000-000000000000?write=1`, undefined, s);
  return r.status !== 403 && r.status !== 401;
}

export async function GET(req: NextRequest, ctx: Ctx) {
  const g = await start(req, ctx, false);
  if (g.error) return g.error;
  const { p, s } = g;
  if (!p.length) return pass(await accountApi("GET", "/v1/me/studio/uploads", undefined, s));
  if (p.length === 1) return pass(await accountApi("GET", `/v1/me/studio/uploads/${p[0]}`, undefined, s));
  if (p.length === 2 && p[1] === "premiere") return pass(await accountApi("GET", `/v1/me/studio/uploads/${p[0]}/premiere`, undefined, s));
  // Live control room (Figma 37:1272).
  if (p.length === 2 && p[1] === "control") return pass(await accountApi("GET", `/v1/me/studio/uploads/${p[0]}/control`, undefined, s));
  // Marketing (Figma 39:779): the clip moments Studio AI picked.
  if (p.length === 2 && p[1] === "clips") return pass(await accountApi("GET", `/v1/me/studio/uploads/${p[0]}/clips`, undefined, s));
  if (p.length === 2 && p[1] === "poster") {
    const r = await accountApi("GET", `/v1/me/studio/uploads/${p[0]}`, undefined, s);
    if (r.status !== 200) return pass(r);
    const key = (r.body as { upload: Upload }).upload.posterKey;
    if (!key || !mediaEnabled) return json(404, { error: "No poster yet" });
    return Response.redirect(await roomObjectLink(key), 302);
  }
  // The parts already in storage, so a file chosen again carries on where it stopped.
  if (p.length === 4 && p[1] === "files" && p[3] === "parts") {
    const f = await fileOf(s, p[0], p[2], true);
    if (!f) return json(404, { error: "Not found" });
    if (f.error) return f.error;
    if (f.file.status !== "uploading" || !f.file.mpId) return json(200, { parts: [] });
    try {
      return json(200, { parts: await uploadedParts(f.file.key, f.file.mpId) });
    } catch {
      return json(200, { parts: [], expired: true });
    }
  }
  return json(404, { error: "Not found" });
}

export async function POST(req: NextRequest, ctx: Ctx) {
  const g = await start(req, ctx, true);
  if (g.error) return g.error;
  const { p, s } = g;
  // AI suggested prices (Figma 35:514), for the studio to review before publishing.
  if (p.length === 2 && p[1] === "suggest-prices") {
    if (limited(`ai:${s}`, 6)) return json(429, { error: "Slow down: try again in a minute" });
    if (!(await mayWrite(s, p[0]))) return json(403, { error: "Your role on this studio cannot do that" });
    const [u, pr] = await Promise.all([accountApi("GET", `/v1/me/studio/uploads/${p[0]}`, undefined, s), accountApi("GET", `/v1/me/studio/uploads/${p[0]}/premiere`, undefined, s)]);
    if (u.status !== 200) return pass(u);
    if (pr.status !== 200) return pass(pr);
    const up = (u.body as { upload: Upload }).upload, pm = (pr.body as { premiere: Premiere }).premiere;
    const body = await req.json().catch(() => ({})) as { rows?: { country: string; amountMinor: number | null }[]; priceCents?: number };
    const rates = await usdRates();
    const rows = (body.rows ?? []).slice(0, 60).flatMap((r) => {
      const m = marketOf(String(r.country));
      if (!m) return [];
      const current = r.amountMinor ? r.amountMinor / 10 ** m.digits : null;
      const rate = rates?.[m.currency];
      return [{ country: m.country, currency: m.currency, current, usd: current && rate ? Math.round((current / rate) * 100) / 100 : null, sold: pm.prices.find((x) => x.country === m.country)?.sold ?? 0 }];
    });
    const master = up.files.find((f) => f.kind === "master" && f.status === "uploaded");
    try {
      const out = await suggestPrices({ title: up.title, genres: up.genres, languages: up.languages, runtime: master?.info.match(/(\d+h \d+m|\d+m \d+s)$/)?.[1] ?? "", baseUsd: Number(body.priceCents ?? pm.priceCents) / 100, seats: pm.seats, startsAt: pm.startsAt }, rows);
      if (!out) return json(503, { error: "AI pricing is not available right now" });
      return json(200, { suggestions: out });
    } catch (e) {
      console.error("price suggestions", e instanceof Error ? e.message : e);
      return json(502, { error: "AI pricing did not answer. Try again." });
    }
  }
  // Control room: message every viewer, settle reported chat, read the audience mood.
  if (p.length === 3 && p[1] === "control" && (p[2] === "announce" || p[2] === "moderate")) {
    const body = await req.json().catch(() => ({}));
    const out = p[2] === "announce" ? { text: String(body.text ?? "").slice(0, 400) } : { messageId: Math.trunc(Number(body.messageId) || 0), hide: body.hide === true };
    return pass(await accountApi("POST", `/v1/me/studio/uploads/${p[0]}/control/${p[2]}`, out, s));
  }
  if (p.length === 3 && p[1] === "clips" && p[2] === "approve") {
    const body = await req.json().catch(() => ({}));
    const idx = Array.isArray(body.idx) ? (body.idx as unknown[]).slice(0, 12).map((x) => Math.trunc(Number(x) || 0)) : [];
    return pass(await accountApi("POST", `/v1/me/studio/uploads/${p[0]}/clips/approve`, { idx }, s));
  }
  // Studio AI picks new moments; saving them needs the marketing role, checked by the API.
  if (p.length === 3 && p[1] === "clips" && p[2] === "generate") {
    if (limited(`c:${s}`, 4)) return json(429, { error: "Slow down: try again in a minute" });
    const body = await req.json().catch(() => ({}));
    const cutoffMs = Math.max(60_000, Math.min(6 * 3600_000, Math.round(Number(body.cutoffMs) || 3_000_000)));
    const r = await accountApi("GET", `/v1/me/studio/uploads/${p[0]}`, undefined, s);
    if (r.status !== 200) return pass(r);
    const u = (r.body as { upload: Upload }).upload;
    const probe = await accountApi("PUT", `/v1/me/studio/uploads/${p[0]}/clips`, { cutoffMs, clips: [] }, s);
    if (probe.status !== 200) return pass(probe);
    try {
      const clips = await pickClips(u.title, u.logline ?? "", u.files, cutoffMs);
      return pass(await accountApi("PUT", `/v1/me/studio/uploads/${p[0]}/clips`, { cutoffMs, clips }, s));
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      if (m === "off") return json(503, { error: "Studio AI is not switched on yet." });
      console.error("clip picks", m);
      return json(m.length < 160 && !/json|token|api/i.test(m) ? 400 : 502, { error: m.length < 160 && !/json|token|api/i.test(m) ? m : "Studio AI did not answer. Try again" });
    }
  }
  if (p.length === 3 && p[1] === "control" && p[2] === "mood") {
    if (limited(`m:${s}`, 6)) return json(429, { error: "Slow down: try again in a minute" });
    const r = await accountApi("GET", `/v1/me/studio/uploads/${p[0]}/control`, undefined, s);
    if (r.status !== 200) return pass(r);
    const c = (r.body as { control: { showtimeId: string; film: string; recent: { body: string; at: string }[] } }).control;
    try {
      const mood = await readMood(c.showtimeId, c.film, c.recent ?? []);
      return mood ? json(200, { mood }) : json(200, { mood: null, why: c.recent?.length >= 5 ? "off" : "quiet" });
    } catch (e) {
      console.error("audience mood", e instanceof Error ? e.message : e);
      return json(502, { error: "Studio AI did not answer. Try again" });
    }
  }
  // The poster: a still image, checked by its first bytes and stored privately.
  if (p.length === 2 && p[1] === "poster") {
    if (limited(`i:${s}`, 10)) return json(429, { error: "Slow down: too many uploads" });
    if (!mediaEnabled) return json(503, { error: "Uploads are paused right now" });
    const form = await req.formData().catch(() => null);
    const file = form?.get("file");
    if (!(file instanceof File)) return json(400, { error: "Choose an image" });
    const type = file.type.split(";")[0];
    if (!IMAGES[type]) return json(400, { error: "Use a JPG, PNG or WebP poster" });
    if (!file.size || file.size > 10 << 20) return json(400, { error: "Posters can be up to 10 MB" });
    const buf = Buffer.from(await file.arrayBuffer());
    const head = buf.subarray(0, 12).toString("latin1");
    if (!/^\xff\xd8|^\x89PNG|^RIFF[\s\S]{4}WEBP/.test(head)) return json(400, { error: "That file does not look like an image" });
    if (!(await mayWrite(s, p[0]))) return json(403, { error: "Only the owner and admins can change the film" });
    const key = `studio-uploads/${p[0]}/poster-${randomUUID()}.${IMAGES[type]}`;
    await putRoomObject(key, buf, type);
    return pass(await accountApi("PUT", `/v1/me/studio/uploads/${p[0]}/poster`, { key }, s));
  }
  const body = await req.json().catch(() => ({}));
  if (!p.length) return pass(await accountApi("POST", "/v1/me/studio/uploads", { title: String(body.title ?? "") }, s));
  if (!mediaEnabled) return json(503, { error: "Uploads are paused right now" });

  // A new file: reserve its place, then open a multipart upload in storage.
  if (p.length === 2 && p[1] === "files") {
    if (limited(`f:${s}`, 60)) return json(429, { error: "Slow down: too many files at once" });
    const r = await accountApi("POST", `/v1/me/studio/uploads/${p[0]}/files`, { name: String(body.name ?? ""), size: Number(body.size) || 0 }, s);
    if (r.status !== 200) return pass(r.status === 400 ? { status: 400, body: { error: "Use ProRes or DNxHR in a .mov or .mxf, WAV, AIFF or FLAC stems, and SRT, VTT or TTML subtitles, up to 2 TB each" } } : r);
    const file = (r.body as { file: UploadFile }).file;
    try {
      const mpId = await startMultipart(file.key, file.contentType);
      return pass(await accountApi("PUT", `/v1/me/studio/uploads/${p[0]}/files/${file.id}`, { mpId }, s));
    } catch (err) {
      console.error("studio upload start failed", (err as Error).message);
      await accountApi("DELETE", `/v1/me/studio/uploads/${p[0]}/files/${file.id}`, undefined, s);
      return json(502, { error: "Storage did not answer. Try again in a moment" });
    }
  }

  // Signed links for the next parts, up to 24 at a time, each good for an hour.
  if (p.length === 4 && p[1] === "files" && p[3] === "parts") {
    if (limited(`p:${s}`, 600)) return json(429, { error: "Slow down" });
    const f = await fileOf(s, p[0], p[2], true);
    if (!f) return json(404, { error: "Not found" });
    if (f.error) return f.error;
    if (f.file.status !== "uploading" || !f.file.mpId) return json(409, { error: "This file is already uploaded" });
    const max = partCount(f.file.size);
    const nums = (Array.isArray(body.parts) ? body.parts : []).map(Number).filter((n: number) => Number.isInteger(n) && n >= 1 && n <= max).slice(0, 24);
    if (!nums.length) return json(400, { error: "No parts asked for" });
    const urls = await Promise.all(nums.map(async (n: number) => ({ part: n, url: await signPart(f.file.key, f.file.mpId, n) })));
    return json(200, { urls });
  }

  // Every part is in: join them, read the file and record what it is.
  if (p.length === 4 && p[1] === "files" && p[3] === "complete") {
    const f = await fileOf(s, p[0], p[2], true);
    if (!f) return json(404, { error: "Not found" });
    if (f.error) return f.error;
    if (f.file.status !== "uploading" || !f.file.mpId) return json(200, { file: f.file });
    const have = await uploadedParts(f.file.key, f.file.mpId).catch(() => null);
    const need = partCount(f.file.size);
    if (!have || have.length !== need || have.reduce((a, x) => a + x.size, 0) !== f.file.size) {
      return json(409, { error: "Some parts are missing. Choose the file again to finish it", have: have?.length ?? 0, need });
    }
    try {
      await finishMultipart(f.file.key, f.file.mpId, have.sort((a, b) => a.part - b.part));
    } catch (err) {
      console.error("studio upload finish failed", (err as Error).message);
      return json(502, { error: "Storage could not join the parts. Try again" });
    }
    let result;
    try {
      result = await inspect(f.file, (a, b) => objectRange(f.file.key, a, b));
    } catch (err) {
      console.error("studio upload check failed", (err as Error).message);
      result = { status: "uploaded" as const, info: "", checks: [{ state: "warn" as const, text: `We could not read ${f.file.name} yet. Our team will look at it` }] };
    }
    return pass(await accountApi("PUT", `/v1/me/studio/uploads/${p[0]}/files/${f.file.id}`, { status: result.status, info: result.info, checks: result.checks }, s));
  }
  return json(404, { error: "Not found" });
}

export async function PUT(req: NextRequest, ctx: Ctx) {
  const g = await start(req, ctx, true);
  if (g.error) return g.error;
  const { p, s } = g;
  const body = await req.json().catch(() => ({}));
  if (p.length === 1) return pass(await accountApi("PUT", `/v1/me/studio/uploads/${p[0]}`, { title: String(body.title ?? "") }, s));
  if (p.length === 2 && p[1] === "details") {
    const str = (k: string) => String(body[k] ?? "");
    return pass(await accountApi("PUT", `/v1/me/studio/uploads/${p[0]}/details`, { title: str("title"), logline: str("logline"), genres: str("genres"), ageRating: str("ageRating"), castCrew: str("castCrew"), languages: str("languages") }, s));
  }
  // A new spoiler cutoff for the clip moments; the API refuses clips that end after it.
  if (p.length === 2 && p[1] === "clips") {
    const clips = Array.isArray(body.clips) ? (body.clips as Record<string, unknown>[]).slice(0, 12).map((c) => ({
      startMs: Math.round(Number(c.startMs) || 0), endMs: Math.round(Number(c.endMs) || 0), title: String(c.title ?? ""), why: String(c.why ?? ""), format: String(c.format ?? ""),
    })) : [];
    const r = await accountApi("PUT", `/v1/me/studio/uploads/${p[0]}/clips`, { cutoffMs: Math.round(Number(body.cutoffMs) || 0), clips }, s);
    // Saving replaces the moments, so carry the approvals over.
    const keep = Array.isArray(body.clips) ? (body.clips as Record<string, unknown>[]).map((c, i) => (c.approved === true ? i : -1)).filter((i) => i >= 0) : [];
    if (r.status === 200 && keep.length) return pass(await accountApi("POST", `/v1/me/studio/uploads/${p[0]}/clips/approve`, { idx: keep }, s));
    return pass(r);
  }
  // Coming-soon post (Figma 53:1512): the early-bird saving and the formats offered.
  if (p.length === 2 && p[1] === "coming-soon") {
    const formats = Array.isArray(body.formats) ? (body.formats as unknown[]).slice(0, 8).map(String) : [];
    const r = await accountApi("PUT", `/v1/me/studio/uploads/${p[0]}/coming-soon`, { earlySave: Math.round(Number(body.earlySave) || 0), formats }, s);
    if (r.status === 200) await refreshLive(true);
    return pass(r);
  }
  if (p.length === 2 && p[1] === "premiere") {
    const n = (k: string) => Math.round(Number(body[k]) || 0);
    const b = (k: string) => body[k] === true;
    const prices = Array.isArray(body.prices) ? (body.prices as Record<string, unknown>[]).slice(0, 250).map((x) => ({ country: String(x.country ?? ""), currency: String(x.currency ?? ""), amountMinor: Math.round(Number(x.amountMinor) || 0), note: String(x.note ?? "") })) : [];
    const startsAt = typeof body.startsAt === "string" && !Number.isNaN(Date.parse(body.startsAt)) ? new Date(body.startsAt).toISOString() : "0001-01-01T00:00:00Z";
    const r = await accountApi("PUT", `/v1/me/studio/uploads/${p[0]}/premiere`, {
      mode: String(body.mode ?? "global"), startsAt, seats: n("seats"), encores: n("encores"), priceCents: n("priceCents"),
      freeSeats: b("freeSeats"), freePlan: b("freePlan"), groupDiscounts: b("groupDiscounts"), studentPrice: b("studentPrice"), classicRequests: b("classicRequests"), downloads: b("downloads"),
      durationMin: n("durationMin"), prices, publish: b("publish"),
    }, s);
    if (r.status === 200 && b("publish")) {
      await refreshLive(true);
      await syncDubs(p[0]).catch(() => {});
    }
    return pass(r);
  }
  return json(404, { error: "Not found" });
}

export async function DELETE(req: NextRequest, ctx: Ctx) {
  const g = await start(req, ctx, true);
  if (g.error) return g.error;
  const { p, s } = g;
  // Delete a draft that never premiered, with every file it holds.
  if (p.length === 1) {
    const r = await accountApi("GET", `/v1/me/studio/uploads/${p[0]}`, undefined, s);
    if (r.status !== 200) return pass(r);
    const u = (r.body as { upload: Upload }).upload;
    if (!(await mayWrite(s, p[0]))) return json(403, { error: "Only the owner and admins can delete a draft" });
    if (mediaEnabled) {
      await Promise.all(u.files.map((f) => dropUpload(f.key, f.mpId, f.status !== "uploading")));
      if (u.posterKey) await dropUpload(u.posterKey, "", true);
    }
    return pass(await accountApi("DELETE", `/v1/me/studio/uploads/${p[0]}`, undefined, s));
  }
  if (p.length === 3 && p[1] === "files") {
    const f = await fileOf(s, p[0], p[2], true);
    if (!f) return json(404, { error: "Not found" });
    if (f.error) return f.error;
    if (mediaEnabled) await dropUpload(f.file.key, f.file.mpId, f.file.status !== "uploading");
    return pass(await accountApi("DELETE", `/v1/me/studio/uploads/${p[0]}/files/${p[2]}`, undefined, s));
  }
  return json(404, { error: "Not found" });
}
