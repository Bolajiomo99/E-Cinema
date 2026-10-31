import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { accountApi, SESSION_COOKIE } from "@/lib/auth";

export const dynamic = "force-dynamic";

// POST adds the viewer's request for a classic; DELETE takes it back.
async function vote(req: NextRequest, ctx: { params: Promise<{ id: string }>; }, method: "POST" | "DELETE") {
  const origin = req.headers.get("origin");
  if (origin && new URL(origin).host !== req.headers.get("host")) return NextResponse.json({ error: "cross-site request" }, { status: 403 });
  const { id } = await ctx.params;
  if (!/^[a-z0-9-]{3,60}$/.test(id)) return NextResponse.json({ error: "Unknown film" }, { status: 404 });
  const session = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!session) return NextResponse.json({ error: "Sign in first" }, { status: 401 });
  const r = await accountApi(method, `/v1/classics/${id}/vote`, undefined, session);
  return NextResponse.json(r.body ?? { ok: true }, { status: r.status === 204 ? 200 : r.status });
}
export const POST = (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => vote(req, ctx, "POST");
export const DELETE = (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => vote(req, ctx, "DELETE");
