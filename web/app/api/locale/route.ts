import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { accountApi, SESSION_COOKIE } from "@/lib/auth";
import { isLang } from "@/lib/i18n";
import { COUNTRY_COOKIE, LANG_COOKIE } from "@/lib/locale";

export const dynamic = "force-dynamic";

const YEAR = 365 * 24 * 3600;

// POST /api/locale { country?, lang? }: remembers the picker choice on this browser and,
// for a signed-in viewer, saves the app language to their profile too.
export async function POST(req: NextRequest) {
  const origin = req.headers.get("origin");
  if (origin && new URL(origin).host !== req.headers.get("host")) return NextResponse.json({ error: "cross-site request" }, { status: 403 });
  const b = (await req.json().catch(() => ({}))) as { country?: string; lang?: string };
  const jar = await cookies();
  const res = NextResponse.json({ ok: true });
  const opts = { path: "/", maxAge: YEAR, sameSite: "lax" as const, secure: process.env.NODE_ENV === "production" };
  if (typeof b.country === "string" && /^[A-Z]{2}$/.test(b.country)) res.cookies.set(COUNTRY_COOKIE, b.country, opts);
  else if (b.country === "") res.cookies.delete(COUNTRY_COOKIE);
  if (isLang(b.lang)) {
    res.cookies.set(LANG_COOKIE, b.lang, opts);
    const session = jar.get(SESSION_COOKIE)?.value;
    if (session) {
      await accountApi("PUT", "/v1/me/profile", { appLanguage: b.lang }, session);
    }
  }
  return res;
}
