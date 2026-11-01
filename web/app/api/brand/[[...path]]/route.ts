import { cookies } from "next/headers";
import type { NextRequest } from "next/server";
import { createHash, randomUUID } from "node:crypto";
import { accountApi, currentAccount, SESSION_COOKIE } from "@/lib/auth";
import { aiCheckEnabled, aiNote, licensees, lookAtPhotos, partnerAt, verifyCode, type PhotoLook } from "@/lib/brand";
import type { Report } from "@/lib/brand-types";
import { convert } from "@/lib/fx";
import { readLocale } from "@/lib/locale";
import { mediaEnabled, objectBytes, putRoomObject, roomObjectLink } from "@/lib/media";
import { json, sameOrigin } from "@/lib/room-gate";
import { isStaff } from "@/lib/store";

// Brand protection (Figma 114:1670, 114:1733, 114:1751, 114:1818): check a product code,
// upload report photos, run the AI check, send a report, and the investigators' desk.
export const dynamic = "force-dynamic";

const IMAGE = new Set(["image/jpeg", "image/png", "image/webp"]);
const PHOTO = /^reports\/[0-9a-f-]{36}\.(jpg|png|webp)$/;
const UUID = /^[0-9a-f-]{36}$/;
const pass = (r: { status: number; body: unknown }) => json(r.status, r.body ?? {});

// Small per-visitor limits, so codes cannot be guessed and photos cannot flood storage.
const hits = new Map<string, number[]>();
function limited(key: string, max: number, windowMs: number) {
  const now = Date.now();
  const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  if (recent.length >= max) return true;
  hits.set(key, [...recent, now]);
  if (hits.size > 5000) hits.clear();
  return false;
}
const visitor = (req: NextRequest) => req.headers.get("cf-connecting-ip") ?? req.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "?";

// Photo looks are cached for the report that follows the preview, so Claude sees them once.
const looks = new Map<string, PhotoLook | null>();
async function look(photos: string[]): Promise<PhotoLook | null> {
  if (!photos.length || !aiCheckEnabled() || !mediaEnabled) return null;
  const key = createHash("sha256").update(photos.join("|")).digest("hex");
  if (looks.has(key)) return looks.get(key)!;
  try {
    const bytes = (await Promise.all(photos.map((p) => objectBytes(p)))).filter((b): b is { body: Buffer; type: string } => Boolean(b));
    const out = bytes.length ? await lookAtPhotos(bytes) : null;
    if (looks.size > 500) looks.clear();
    looks.set(key, out);
    return out;
  } catch (err) {
    console.error("report photo check failed", (err as Error).message);
    return null;
  }
}

async function check(link: string, photos: string[]) {
  const [l, list] = await Promise.all([look(photos), licensees()]);
  const isWeb = /^(https?:\/\/)?[a-z0-9-]+(\.[a-z0-9-]+)+(\/\S*)?$/i.test(link.trim());
  return aiNote(l, partnerAt(list, link), isWeb);
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ path?: string[] }> }) {
  const p = (await params).path ?? [];
  if (p[0] === "desk") {
    const me = await currentAccount();
    if (!isStaff(me?.email)) return json(403, { error: "Staff only" });
    const r = await accountApi("GET", "/v1/brand/reports/open");
    if (r.status !== 200) return pass(r);
    const reports = (r.body as { reports: Report[] }).reports;
    const signed = await Promise.all(reports.map(async (x) => ({ ...x, photos: mediaEnabled ? await Promise.all(x.photos.map((k) => roomObjectLink(k))) : [] })));
    return json(200, { reports: signed });
  }
  if (p[0] === "rewards") {
    const session = (await cookies()).get(SESSION_COOKIE)?.value;
    if (!session) return json(401, { error: "Sign in first", signIn: true });
    return pass(await accountApi("GET", `/v1/me/rewards?country=${(await readLocale()).country ?? ""}`, undefined, session));
  }
  return json(404, { error: "Not found" });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ path?: string[] }> }) {
  if (!sameOrigin(req)) return json(403, { error: "forbidden" });
  const p = (await params).path ?? [];

  if (p[0] === "verify") {
    if (limited(`v:${visitor(req)}`, 30, 60_000)) return json(429, { error: "Too many checks. Wait a minute and try again." });
    const { code } = (await req.json().catch(() => ({}))) as { code?: string };
    if (typeof code !== "string" || code.length > 200) return json(400, { error: "Type the code on the label" });
    const country = req.headers.get("cf-ipcountry") ?? (await readLocale()).country ?? "";
    const city = decodeURIComponent(req.headers.get("cf-ipcity") ?? "");
    const c = await verifyCode(code, city, country === "XX" ? "" : country);
    return c ? json(200, c) : json(502, { error: "The checker is not answering. Try again." });
  }

  const session = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!session) return json(401, { error: "Sign in to report a seller", signIn: true });

  if (p[0] === "photo") {
    if (!mediaEnabled) return json(503, { error: "Photo uploads are paused right now" });
    if (limited(`p:${session}`, 12, 60_000)) return json(429, { error: "Slow down: too many uploads" });
    const form = await req.formData().catch(() => null);
    const file = form?.get("file");
    if (!(file instanceof File)) return json(400, { error: "Choose a photo" });
    const type = file.type.split(";")[0];
    if (!IMAGE.has(type)) return json(400, { error: "Photos must be JPG, PNG or WebP" });
    if (file.size === 0 || file.size > 8 << 20) return json(400, { error: "That photo is too big (up to 8 MB)" });
    const buf = Buffer.from(await file.arrayBuffer());
    if (!/^\xff\xd8|^\x89PNG|^RIFF[^]{4}WEBP/.test(buf.subarray(0, 12).toString("latin1"))) return json(400, { error: "That file does not look like a photo" });
    const key = `reports/${randomUUID()}.${type === "image/jpeg" ? "jpg" : type.split("/")[1]}`;
    await putRoomObject(key, buf, type);
    return json(200, { key });
  }

  if (p[0] === "check" || p[0] === "report") {
    const b = (await req.json().catch(() => ({}))) as { place?: string; link?: string; selling?: string; code?: string; photos?: unknown; anonymous?: boolean };
    const photos = Array.isArray(b.photos) ? b.photos.filter((x): x is string => typeof x === "string" && PHOTO.test(x)).slice(0, 6) : [];
    const link = typeof b.link === "string" ? b.link.slice(0, 300) : "";
    if (p[0] === "check") {
      if (limited(`c:${session}`, 10, 60_000)) return json(429, { error: "Slow down" });
      return json(200, await check(link, photos));
    }
    const { note } = await check(link, photos);
    const country = (await readLocale()).country ?? "";
    return pass(await accountApi("POST", "/v1/me/brand-reports", { place: b.place, link, selling: b.selling, code: b.code ?? "", photos, aiNote: note, anonymous: Boolean(b.anonymous), country }, session));
  }

  if (p[0] === "desk" && UUID.test(p[1] ?? "")) {
    const me = await currentAccount();
    if (!isStaff(me?.email)) return json(403, { error: "Staff only" });
    const b = (await req.json().catch(() => ({}))) as { status?: string; outcome?: string; rewardNgn?: number };
    const reward = Math.round(Number(b.rewardNgn) || 0);
    let creditCents = 0;
    if (b.status === "confirmed") {
      const usd = await convert(reward, "NGN", "USD");
      if (usd == null) return json(503, { error: "Exchange rates are not available right now, so the reward cannot be paid yet. Try again shortly." });
      creditCents = Math.max(1, Math.round(usd * 100));
    }
    return pass(await accountApi("POST", `/v1/brand/reports/${p[1]}/decide`, { status: b.status, outcome: b.outcome ?? "", rewardNgn: reward, creditCents }));
  }
  return json(404, { error: "Not found" });
}
