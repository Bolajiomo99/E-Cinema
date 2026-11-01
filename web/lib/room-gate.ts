import "server-only";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { accountApi, SESSION_COOKIE } from "@/lib/auth";
import { findShowtime, type Showtime } from "@/lib/catalog";

export const json = (status: number, body: unknown) =>
  status === 204 ? new NextResponse(null, { status, headers: { "Cache-Control": "no-store" } }) : NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

export type RoomAccess = { s: Showtime; session: string; accountId: string; lang: string; startsAt: number };

// Room routes are for ticket holders only. Returns the access, or the response to send instead.
export async function roomGate(showtime: string): Promise<RoomAccess | NextResponse> {
  const s = findShowtime(showtime);
  const session = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!s) return json(404, { error: "No such premiere" });
  if (!session) return json(401, { error: "Sign in first" });
  const r = await accountApi("GET", `/v1/rooms/${encodeURIComponent(s.id)}/access`, undefined, session);
  if (r.status === 401) return json(401, { error: "Sign in first" });
  const b = r.body as { hasTicket?: boolean; accountId?: string; lang?: string; startsAt?: string };
  if (r.status !== 200 || !b.hasTicket || !b.accountId) return json(403, { error: "The room is for ticket holders" });
  return { s, session, accountId: b.accountId, lang: (b.lang || "en").split("-")[0], startsAt: Date.parse(b.startsAt ?? s.startsAt) };
}

export const sameOrigin = (req: Request) => {
  const origin = req.headers.get("origin");
  return !origin || new URL(origin).host === req.headers.get("host");
};
