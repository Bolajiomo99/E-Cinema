import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { accountApi, SESSION_COOKIE } from "@/lib/auth";
import { findShowtime } from "@/lib/catalog";

// Enter the free-seat draw, claim a win, or join the waitlist (Figma 31:1121).
const json = (status: number, body: unknown) => (status === 204 ? new NextResponse(null, { status }) : NextResponse.json(body ?? {}, { status, headers: { "Cache-Control": "no-store" } }));

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string; action: string }> }) {
  const origin = req.headers.get("origin");
  if (origin && new URL(origin).host !== req.headers.get("host")) return json(403, { error: "forbidden" });
  const { id, action } = await params;
  if (!findShowtime(id)) return json(404, { error: "Unknown premiere" });
  const session = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!session) return json(401, { error: "Sign in first", signIn: true });
  const b = (await req.json().catch(() => ({}))) as { holdId?: string; on?: boolean };
  const path = `/v1/lottery/${encodeURIComponent(id)}`;
  let r;
  if (action === "enter") r = await accountApi("POST", `${path}/enter`, {}, session);
  else if (action === "claim") r = await accountApi("POST", `${path}/claim`, { holdId: b.holdId }, session);
  else if (action === "waitlist") r = await accountApi("PUT", `/v1/waitlist/${encodeURIComponent(id)}`, { on: b.on !== false }, session);
  else return json(404, { error: "not found" });
  return json(r.status, r.body);
}
