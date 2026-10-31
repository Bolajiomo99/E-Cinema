import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { accountApi, currentAccount, SESSION_COOKIE } from "@/lib/auth";
import { inviteByEmail } from "@/lib/party-invites";

export const dynamic = "force-dynamic";

const CODE = /^[a-z0-9-]{6,40}$/;

// POST /api/parties/<code>/join | leave | invites | end
export async function POST(req: NextRequest, ctx: { params: Promise<{ code: string; action: string }> }) {
  const origin = req.headers.get("origin");
  if (origin && new URL(origin).host !== req.headers.get("host")) return NextResponse.json({ error: "cross-site request" }, { status: 403 });
  const { code, action } = await ctx.params;
  if (!CODE.test(code)) return NextResponse.json({ error: "Unknown party" }, { status: 404 });
  const session = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!session) return NextResponse.json({ error: "Sign in first" }, { status: 401 });
  if (action === "end") {
    const r = await accountApi("DELETE", `/v1/parties/${code}`, undefined, session);
    return NextResponse.json(r.body ?? { ok: true }, { status: r.status === 204 ? 200 : r.status });
  }
  if (action !== "join" && action !== "leave" && action !== "invites") return NextResponse.json({ error: "Unknown action" }, { status: 404 });
  const b = action === "invites" ? await req.json().catch(() => ({})) : undefined;
  const r = await accountApi("POST", `/v1/parties/${code}/${action}`, action === "invites" ? { emails: Array.isArray(b?.emails) ? b.emails.map(String).slice(0, 50) : [] } : {}, session);
  if (action === "invites" && r.status === 200) {
    const me = await currentAccount();
    const sent = await inviteByEmail(r.body as never, me?.name ?? "A friend", Array.isArray(b?.emails) ? b.emails.map(String) : []);
    return NextResponse.json({ ...(r.body as object), emailed: sent });
  }
  return NextResponse.json(r.body ?? { ok: true }, { status: r.status === 204 ? 200 : r.status });
}
