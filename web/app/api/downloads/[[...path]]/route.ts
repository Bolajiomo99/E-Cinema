import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { accountApi, SESSION_COOKIE } from "@/lib/auth";
import { filmFile, mediaEnabled } from "@/lib/media";
import { json, sameOrigin } from "@/lib/room-gate";

// Downloads (Figma 31:743). Licences live in the Go API; the film's bytes stream through
// here only for a device holding a live licence, and are encrypted in the browser on arrival.
export const dynamic = "force-dynamic";

const FILM = /^[a-z0-9-]{1,80}$/;
const DEVICE = /^[a-z0-9]{16,40}$/;

async function session() {
  return (await cookies()).get(SESSION_COOKIE)?.value;
}
const relay = (r: { status: number; body: unknown }) => (r.status === 204 ? new NextResponse(null, { status: 204 }) : json(r.status, r.body ?? {}));

export async function GET(req: NextRequest, ctx: { params: Promise<{ path?: string[] }> }) {
  const p = (await ctx.params).path ?? [];
  const s = await session();
  if (!s) return json(401, { error: "Sign in first" });
  if (p.length === 0) return relay(await accountApi("GET", "/v1/me/downloads", undefined, s));
  if (!FILM.test(p[0]) || !DEVICE.test(p[1] ?? "")) return json(404, { error: "not found" });
  const check = await accountApi("GET", `/v1/me/downloads/${p[0]}/${p[1]}`, undefined, s);
  if (p.length === 2) return relay(check);
  if (p.length !== 3 || p[2] !== "file") return json(404, { error: "not found" });
  if (check.status !== 200) return relay(check);
  if (!mediaEnabled) return json(503, { error: "Downloads are being switched on. Please try again soon." });
  const q = (check.body as { quality: "sd" | "hd" }).quality;
  const file = await filmFile(q);
  if (!file) return json(503, { error: "The film is not available to download right now." });
  return new NextResponse(file.body, {
    headers: { "Content-Type": "application/octet-stream", "Cache-Control": "no-store", "X-Film-Credit": encodeURIComponent(file.credit), ...(file.size ? { "Content-Length": String(file.size) } : {}) },
  });
}

export async function PUT(req: NextRequest, ctx: { params: Promise<{ path?: string[] }> }) {
  if (!sameOrigin(req)) return json(403, { error: "forbidden" });
  const p = (await ctx.params).path ?? [];
  if (p.length !== 1 || !FILM.test(p[0])) return json(404, { error: "not found" });
  const s = await session();
  if (!s) return json(401, { error: "Sign in first" });
  const b = await req.json().catch(() => ({}));
  return relay(await accountApi("PUT", `/v1/me/downloads/${p[0]}`, b, s));
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ path?: string[] }> }) {
  if (!sameOrigin(req)) return json(403, { error: "forbidden" });
  const p = (await ctx.params).path ?? [];
  if (p.length !== 2 || !FILM.test(p[0]) || !DEVICE.test(p[1])) return json(404, { error: "not found" });
  const s = await session();
  if (!s) return json(401, { error: "Sign in first" });
  return relay(await accountApi("DELETE", `/v1/me/downloads/${p[0]}/${p[1]}`, undefined, s));
}
