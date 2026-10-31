import { NextResponse, type NextRequest } from "next/server";
import { googleEnabled, siteUrl, startGoogle } from "@/lib/google";

export const dynamic = "force-dynamic";

export function GET(req: NextRequest) {
  const base = siteUrl(req.nextUrl.origin);
  if (!googleEnabled) return NextResponse.redirect(`${base}/signin?error=google-off`);
  const { url, cookie } = startGoogle(base);
  const res = NextResponse.redirect(url);
  res.cookies.set("g_oauth", cookie, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/api/auth/google",
    maxAge: 600,
  });
  return res;
}
