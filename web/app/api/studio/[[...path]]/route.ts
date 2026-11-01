import type { NextRequest } from "next/server";
import { randomUUID } from "node:crypto";
import { accountApi, currentAccount } from "@/lib/auth";
import { aiEnabled, readCertificate, session } from "@/lib/licensing";
import { mediaEnabled, putRoomObject, roomObjectLink } from "@/lib/media";
import { json, sameOrigin } from "@/lib/room-gate";
import { isStaff } from "@/lib/store";
import type { Studio } from "@/lib/studio-types";

// The studio portal (Figma 34:49 to 39:1184): onboarding, the studio's own numbers, its team,
// and the studio desk where E-Cinema staff verify new studios.
export const dynamic = "force-dynamic";

const TYPES: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "application/pdf": "pdf" };
const KEY = /^studios\/[0-9a-f-]{36}\.(jpg|png|pdf)$/;
const SLUG = /^[a-z0-9-]{1,90}$/;
const PAGES = new Set(["overview", "films", "payouts", "team"]);
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
  return json(404, { error: "Not found" });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ path?: string[] }> }) {
  if (!sameOrigin(req)) return json(403, { error: "forbidden" });
  const p = (await params).path ?? [];
  const s = await session();
  if (!s) return json(401, { error: "Sign in first", signIn: true });

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

  if (p[0] === "desk" && SLUG.test(p[1] ?? "")) {
    const me = await currentAccount();
    if (!isStaff(me?.email)) return json(403, { error: "Staff only" });
    return pass(await accountApi("POST", `/v1/studios/${p[1]}/review`, body));
  }
  return json(404, { error: "Not found" });
}
