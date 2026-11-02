import type { NextRequest } from "next/server";
import { accountApi } from "@/lib/auth";
import { session } from "@/lib/licensing";
import { dropPrefix, dropUpload, mediaEnabled, roomObjectLink } from "@/lib/media";
import { json, sameOrigin } from "@/lib/room-gate";
import { regenerateLine, sweepDubs, syncDubs, type Line } from "@/lib/dub-worker";

// AI dubbing (Figma 35:871): languages, the translated script, voicing and approval.
// The Go API checks the studio role on every call; this route adds storage and the AI steps.
export const dynamic = "force-dynamic";

const ID = /^[0-9a-f-]{36}$/;
const LANG = /^[a-z]{2,3}$/;
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

type Ctx = { params: Promise<{ upload: string; path?: string[] }> };

async function start(req: NextRequest, ctx: Ctx, write: boolean) {
  if (write && !sameOrigin(req)) return { error: json(403, { error: "forbidden" }) };
  const { upload, path = [] } = await ctx.params;
  if (!ID.test(upload) || (path[0] && !LANG.test(path[0]))) return { error: json(404, { error: "Not found" }) };
  const s = await session();
  if (!s) return { error: json(401, { error: "Sign in first", signIn: true }) };
  return { u: upload, p: path, s, base: `/v1/me/studio/uploads/${upload}/dubs` };
}

export async function GET(req: NextRequest, ctx: Ctx) {
  const g = await start(req, ctx, false);
  if (g.error) return g.error;
  const { p, s, base } = g;
  if (!p.length) return pass(await accountApi("GET", base, undefined, s));
  if (p.length === 1) return pass(await accountApi("GET", `${base}/${p[0]}`, undefined, s));
  // A voiced line, for "Play dub": a short-lived link, only for people on the studio.
  if (p.length === 4 && p[1] === "lines" && /^\d{1,4}$/.test(p[2]) && p[3] === "audio") {
    const d = await accountApi("GET", `${base}/${p[0]}`, undefined, s);
    if (d.status !== 200) return pass(d);
    const line = (d.body as { lines: Line[] }).lines.find((l) => l.idx === Number(p[2]));
    if (!line?.audioKey || !mediaEnabled || !line.audioKey.startsWith(`studio-dubs/${g.u}/${p[0]}/`)) return json(404, { error: "This line has no voice yet" });
    return json(200, { url: await roomObjectLink(line.audioKey) });
  }
  return json(404, { error: "Not found" });
}

export async function POST(req: NextRequest, ctx: Ctx) {
  const g = await start(req, ctx, true);
  if (g.error) return g.error;
  const { u, p, s, base } = g;
  // Add a language (or retry one that failed); the worker picks it up straight away.
  if (p.length === 1) {
    if (limited(`d:${s}`, 10)) return json(429, { error: "Slow down: try again in a minute" });
    const r = await accountApi("POST", base, { lang: p[0] }, s);
    if (r.status === 200) void sweepDubs();
    return pass(r);
  }
  if (p.length === 2 && p[1] === "voice") {
    const r = await accountApi("POST", `${base}/${p[0]}/voice`, undefined, s);
    if (r.status === 200) void sweepDubs();
    return pass(r);
  }
  if (p.length === 2 && p[1] === "approve") {
    const r = await accountApi("POST", `${base}/${p[0]}/approve`, undefined, s);
    if (r.status === 200) await syncDubs(u).catch((e) => console.error("dub sync", e instanceof Error ? e.message : e));
    return pass(r);
  }
  // "Regenerate line": a fresh AI take on one line, using its flag as the brief.
  if (p.length === 4 && p[1] === "lines" && /^\d{1,4}$/.test(p[2]) && p[3] === "regenerate") {
    if (limited(`r:${s}`, 20)) return json(429, { error: "Slow down: try again in a minute" });
    const [d, up] = await Promise.all([accountApi("GET", `${base}/${p[0]}`, undefined, s), accountApi("GET", `/v1/me/studio/uploads/${u}`, undefined, s)]);
    if (d.status !== 200) return pass(d);
    const lines = (d.body as { lines: Line[] }).lines;
    const idx = Number(p[2]);
    const line = lines.find((l) => l.idx === idx);
    if (!line) return json(404, { error: "Not found" });
    // Saving the line unchanged checks the edit role and that the language is not busy.
    const probe = await accountApi("PUT", `${base}/${p[0]}/lines/${idx}`, { text: line.text, clearFlag: false }, s);
    if (probe.status !== 200) return pass(probe);
    let out;
    try {
      out = await regenerateLine((up.body as { upload?: { title: string } })?.upload?.title ?? "", p[0], line, lines.slice(Math.max(0, idx - 2), idx + 3).filter((l) => l.idx !== idx).map((l) => l.text));
    } catch (e) {
      const off = e instanceof Error && e.message === "off";
      if (!off) console.error("regenerate line", e instanceof Error ? e.message : e);
      return json(off ? 503 : 502, { error: off ? "AI rewriting is not switched on yet" : "The AI did not answer. Try again" });
    }
    const r = await accountApi("PUT", `${base}/${p[0]}/lines/${idx}`, { text: out.text, clearFlag: true }, s);
    if (r.status !== 200) return pass(r);
    if (out.flag) {
      await fetch(`${process.env.API_URL}/v1/studio-dubs/${u}/${p[0]}/lines/${idx}`, {
        method: "PUT",
        headers: { Authorization: `Bearer ${process.env.INTERNAL_API_TOKEN}`, "Content-Type": "application/json" },
        body: JSON.stringify({ text: out.text, flag: out.flag }),
        signal: AbortSignal.timeout(10_000),
      }).catch(() => {});
    }
    await syncDubs(u).catch(() => {});
    return json(200, { line: { ...(r.body as { line: Line }).line, flag: out.flag } });
  }
  return json(404, { error: "Not found" });
}

export async function PUT(req: NextRequest, ctx: Ctx) {
  const g = await start(req, ctx, true);
  if (g.error) return g.error;
  const { u, p, s, base } = g;
  const body = await req.json().catch(() => ({}));
  if (p.length === 1) {
    return pass(await accountApi("PUT", `${base}/${p[0]}`, { voice: String(body.voice ?? "ai"), lipSync: body.lipSync === true, keepMusic: body.keepMusic === true }, s));
  }
  if (p.length === 3 && p[1] === "lines" && /^\d{1,4}$/.test(p[2])) {
    const r = await accountApi("PUT", `${base}/${p[0]}/lines/${p[2]}`, { text: String(body.text ?? "").slice(0, 600), clearFlag: body.clearFlag === true }, s);
    // An edited line in an approved language sends it back to review, off the room's player.
    if (r.status === 200) await syncDubs(u).catch(() => {});
    return pass(r);
  }
  return json(404, { error: "Not found" });
}

export async function DELETE(req: NextRequest, ctx: Ctx) {
  const g = await start(req, ctx, true);
  if (g.error) return g.error;
  const { u, p, s, base } = g;
  if (p.length !== 1) return json(404, { error: "Not found" });
  const r = await accountApi("DELETE", `${base}/${p[0]}`, undefined, s);
  if (r.status === 200 && mediaEnabled) {
    const keys = ((r.body as { keys?: string[] }).keys ?? []).filter((k) => k.startsWith(`studio-dubs/${u}/${p[0]}/`));
    for (let i = 0; i < keys.length; i += 20) await Promise.all(keys.slice(i, i + 20).map((k) => dropUpload(k, "", true)));
    // Lines that were edited after voicing left older clips behind; clear the whole folder.
    await dropPrefix(`studio-dubs/${u}/${p[0]}/`).catch(() => {});
    await syncDubs(u).catch(() => {});
  }
  return pass(r.status === 200 ? { status: 200, body: { ok: true } } : r);
}
