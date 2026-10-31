import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { accountApi, currentAccount, SESSION_COOKIE } from "@/lib/auth";
import { inviteByEmail } from "@/lib/party-invites";

export const dynamic = "force-dynamic";

const sameSite = (req: NextRequest) => {
  const origin = req.headers.get("origin");
  return !origin || new URL(origin).host === req.headers.get("host");
};

// POST /api/parties: start a watch party. GET: the viewer's parties and open ones.
export async function POST(req: NextRequest) {
  if (!sameSite(req)) return NextResponse.json({ error: "cross-site request" }, { status: 403 });
  const session = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!session) return NextResponse.json({ error: "Sign in to start a watch party" }, { status: 401 });
  const b = await req.json().catch(() => ({}));
  const r = await accountApi("POST", "/v1/parties", {
    showtimeId: String(b.showtimeId ?? ""), name: String(b.name ?? "").slice(0, 80),
    visibility: b.visibility === "invite" ? "invite" : "link",
    rules: Array.isArray(b.rules) ? b.rules.map(String).slice(0, 8) : [],
    invite: Array.isArray(b.invite) ? b.invite.map(String).slice(0, 50) : [],
  }, session);
  if (r.status === 201) {
    const me = await currentAccount();
    const sent = await inviteByEmail(r.body as never, me?.name ?? "A friend", Array.isArray(b.invite) ? b.invite.map(String) : []);
    return NextResponse.json({ ...(r.body as object), emailed: sent }, { status: 201 });
  }
  return NextResponse.json(r.body, { status: r.status });
}

export async function GET() {
  const session = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!session) return NextResponse.json([], { status: 200 });
  const r = await accountApi("GET", "/v1/me/parties", undefined, session);
  return NextResponse.json(r.body, { status: r.status, headers: { "Cache-Control": "no-store" } });
}
