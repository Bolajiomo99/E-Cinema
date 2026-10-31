import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { accountApi, SESSION_COOKIE } from "@/lib/auth";

export const dynamic = "force-dynamic";

// GET /api/me/tickets: the viewer's paid seats and the holds waiting for their PayPal approval.
export async function GET() {
  const session = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!session) return NextResponse.json({ error: "sign in first" }, { status: 401 });
  const r = await accountApi("GET", "/v1/me/tickets", undefined, session);
  return NextResponse.json(r.body, { status: r.status, headers: { "Cache-Control": "no-store" } });
}
