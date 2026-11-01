import { cookies } from "next/headers";
import type { NextRequest } from "next/server";
import { accountApi, SESSION_COOKIE } from "@/lib/auth";
import { findShowtime } from "@/lib/catalog";
import { json, sameOrigin } from "@/lib/room-gate";

// Save the viewer's rating and review (Figma 96:1302).
export async function PUT(req: NextRequest, { params }: { params: Promise<{ showtime: string }> }) {
  if (!sameOrigin(req)) return json(403, { error: "forbidden" });
  const s = findShowtime((await params).showtime);
  const session = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!s) return json(404, { error: "No such premiere" });
  if (!session) return json(401, { error: "Sign in first" });
  const b = (await req.json().catch(() => ({}))) as { stars?: unknown; tags?: unknown; body?: unknown };
  const r = await accountApi("PUT", `/v1/me/reviews/${encodeURIComponent(s.id)}`, {
    stars: Number(b.stars), tags: Array.isArray(b.tags) ? b.tags.filter((t) => typeof t === "string").slice(0, 10) : [], body: typeof b.body === "string" ? b.body.slice(0, 600) : "",
  }, session);
  return json(r.status, r.body);
}
