import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { accountApi, deviceLabel, SESSION_COOKIE } from "@/lib/auth";

export const dynamic = "force-dynamic";

type Session = { token: string; expiresAt: string; signedOut: number };

const json = (status: number, body: unknown) =>
  NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

// Blocks cross-site form posts: a mutating request must come from this site.
function sameOrigin(req: NextRequest) {
  const origin = req.headers.get("origin");
  return !origin || origin === req.nextUrl.origin || new URL(origin).host === req.headers.get("host");
}

async function readBody(req: NextRequest): Promise<Record<string, unknown>> {
  try {
    const b = await req.json();
    return b && typeof b === "object" ? b : {};
  } catch {
    return {};
  }
}

const relay = (r: { status: number; body: unknown }) => json(r.status, r.body);

// Puts the session token in an httpOnly cookie and keeps it out of the JSON page scripts can read.
function withSession(r: { status: number; body: unknown }) {
  const body = r.body as { session?: Session } | null;
  const s = body?.session;
  if (!s?.token) return relay(r);
  const res = json(r.status, { ...body, session: { expiresAt: s.expiresAt, signedOut: s.signedOut } });
  res.cookies.set(SESSION_COOKIE, s.token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: new Date(s.expiresAt),
  });
  return res;
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ action: string[] }> }) {
  const action = (await params).action.join("/");
  const session = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!session) return json(401, { error: "not signed in" });
  if (action === "me") return relay(await accountApi("GET", "/v1/sessions/current", undefined, session));
  if (action === "devices") return relay(await accountApi("GET", "/v1/devices", undefined, session));
  return json(404, { error: "not found" });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ action: string[] }> }) {
  if (!sameOrigin(req)) return json(403, { error: "forbidden" });
  const action = (await params).action.join("/");
  const b = await readBody(req);
  const session = (await cookies()).get(SESSION_COOKIE)?.value;
  const device = await deviceLabel();
  switch (action) {
    case "signup":
      if (b.terms !== true) return json(400, { error: "Please agree to the Terms and Privacy Policy" });
      return withSession(await accountApi("POST", "/v1/accounts", { email: b.email, name: b.name, password: b.password, device }));
    case "signin":
      return withSession(await accountApi("POST", "/v1/sessions", { email: b.email, password: b.password, device }));
    case "signout": {
      if (session) await accountApi("DELETE", "/v1/sessions/current", undefined, session);
      const res = json(200, { ok: true });
      res.cookies.delete(SESSION_COOKIE);
      return res;
    }
    case "phone":
      if (!session) return json(401, { error: "not signed in" });
      return relay(await accountApi("POST", "/v1/phone", { phone: b.phone }, session));
    case "phone/confirm":
      if (!session) return json(401, { error: "not signed in" });
      return relay(await accountApi("POST", "/v1/phone/confirm", { code: b.code }, session));
    case "identity/token":
    case "identity/refresh":
      if (!session) return json(401, { error: "not signed in" });
      return relay(await accountApi("POST", `/v1/${action}`, {}, session));
  }
  return json(404, { error: "not found" });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ action: string[] }> }) {
  if (!sameOrigin(req)) return json(403, { error: "forbidden" });
  const [kind, id] = (await params).action;
  const session = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!session) return json(401, { error: "not signed in" });
  if (kind === "devices" && id && /^[0-9a-f-]{36}$/.test(id)) {
    return relay(await accountApi("DELETE", `/v1/devices/${id}`, undefined, session));
  }
  return json(404, { error: "not found" });
}
