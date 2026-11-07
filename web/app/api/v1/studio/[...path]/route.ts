import { NextResponse, type NextRequest } from "next/server";

// The read-only studio API (Figma 39:1073 "API keys"): a studio's own systems call
//   GET https://e-cinema.net/api/v1/studio/films
//   GET https://e-cinema.net/api/v1/studio/films/<showtime id>/sales
//   GET https://e-cinema.net/api/v1/studio/payouts
// with "Authorization: Bearer ecs_…". Each key gets 60 calls a minute.
export const dynamic = "force-dynamic";

const base = process.env.API_URL;
const token = process.env.INTERNAL_API_TOKEN;
const ID = /^[a-z0-9-]{1,80}$/;
const calls = new Map<string, number[]>();
const out = (status: number, body: unknown, extra: Record<string, string> = {}) =>
  NextResponse.json(body, { status, headers: { "Cache-Control": "no-store", ...extra } });

export async function GET(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const p = (await params).path;
  const path = p.length === 1 && (p[0] === "films" || p[0] === "payouts") ? p[0]
    : p.length === 3 && p[0] === "films" && ID.test(p[1]) && p[2] === "sales" ? `films/${p[1]}/sales` : "";
  if (!path) return out(404, { error: "Unknown endpoint. Use /films, /films/<showtime id>/sales or /payouts" });
  const key = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!/^ecs_[0-9a-f]{40}$/.test(key)) return out(401, { error: "Send your studio API key as: Authorization: Bearer ecs_…" }, { "WWW-Authenticate": "Bearer" });
  if (!base || !token) return out(503, { error: "The studio API is not switched on here" });
  const now = Date.now();
  const id = key.slice(0, 20);
  const list = (calls.get(id) ?? []).filter((t) => now - t < 60_000);
  if (list.length >= 60) return out(429, { error: "Slow down: 60 calls a minute per key" }, { "Retry-After": "60" });
  calls.set(id, [...list, now]);
  if (calls.size > 5000) calls.clear();
  const r = await fetch(`${base}/v1/studio-api/${path}`, {
    headers: { Authorization: `Bearer ${token}`, "X-Studio-Key": key },
    signal: AbortSignal.timeout(10000),
    cache: "no-store",
  }).catch(() => null);
  if (!r) return out(502, { error: "Try again in a moment" });
  return out(r.status, await r.json().catch(() => ({})), { "X-RateLimit-Remaining": String(59 - list.length) });
}
