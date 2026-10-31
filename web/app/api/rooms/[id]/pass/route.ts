import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { accountApi, SESSION_COOKIE } from "@/lib/auth";

export const dynamic = "force-dynamic";

// POST /api/rooms/<showtime>/pass: a five-minute pass the browser uses to open the room's
// live connection. The API only issues it to someone holding a paid ticket.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const origin = req.headers.get("origin");
  if (origin && new URL(origin).host !== req.headers.get("host")) {
    return NextResponse.json({ error: "cross-site request" }, { status: 403 });
  }
  const { id } = await params;
  if (!/^[a-z0-9-]{1,80}$/.test(id)) return NextResponse.json({ error: "unknown screening" }, { status: 404 });
  const session = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!session) return NextResponse.json({ error: "sign in first" }, { status: 401 });
  const r = await accountApi("POST", `/v1/rooms/${id}/pass`, {}, session);
  return NextResponse.json(r.body, { status: r.status, headers: { "Cache-Control": "no-store" } });
}
