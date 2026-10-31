import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { accountApi, SESSION_COOKIE } from "@/lib/auth";

export const dynamic = "force-dynamic";

const sameSite = (req: NextRequest) => {
  const origin = req.headers.get("origin");
  return !origin || new URL(origin).host === req.headers.get("host");
};

// GET / PUT /api/me/profile: the sign-up details (country, birthday, languages, mobile).
export async function GET() {
  const session = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!session) return NextResponse.json({ error: "sign in first" }, { status: 401 });
  const r = await accountApi("GET", "/v1/me/profile", undefined, session);
  return NextResponse.json(r.body, { status: r.status, headers: { "Cache-Control": "no-store" } });
}

export async function PUT(req: NextRequest) {
  if (!sameSite(req)) return NextResponse.json({ error: "cross-site request" }, { status: 403 });
  const session = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!session) return NextResponse.json({ error: "sign in first" }, { status: 401 });
  const b = await req.json().catch(() => ({}));
  const pick = (k: string) => (typeof b[k] === "string" ? b[k].slice(0, 40) : "");
  const r = await accountApi("PUT", "/v1/me/profile", {
    country: pick("country"), birthDate: pick("birthDate"), gender: pick("gender"),
    appLanguage: pick("appLanguage"), audioLanguage: pick("audioLanguage"), contactPhone: pick("contactPhone"),
  }, session);
  return NextResponse.json(r.body, { status: r.status });
}
