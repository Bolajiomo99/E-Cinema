import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { accountApi, SESSION_COOKIE } from "@/lib/auth";

// DELETE /api/me/holds/<id>: give back seats the viewer (or their AI agent) is holding but has not paid for.
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const origin = req.headers.get("origin");
  if (origin && new URL(origin).host !== req.headers.get("host")) {
    return NextResponse.json({ error: "cross-site request" }, { status: 403 });
  }
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) return NextResponse.json({ error: "unknown hold" }, { status: 404 });
  const session = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!session) return NextResponse.json({ error: "sign in first" }, { status: 401 });
  const r = await accountApi("DELETE", `/v1/me/holds/${id}`, undefined, session);
  return r.status === 204 ? new NextResponse(null, { status: 204 }) : NextResponse.json(r.body, { status: r.status });
}
