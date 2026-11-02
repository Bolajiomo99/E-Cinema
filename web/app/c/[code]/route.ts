import { NextRequest, NextResponse } from "next/server";
import { accountApi } from "@/lib/auth";

// A studio's campaign link (Figma 39:779): counts the visit, remembers the campaign for a week
// so seats bought afterwards count towards it, and opens the film's page.
export async function GET(req: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const home = new URL("/", req.nextUrl.origin);
  if (!/^[a-z0-9]{8}$/.test(code)) return NextResponse.redirect(home);
  const r = await accountApi("POST", `/v1/campaign-visits/${code}`).catch(() => ({ status: 502, body: null }));
  const showtime = r.status === 200 ? (r.body as { showtimeId?: string })?.showtimeId : undefined;
  if (!showtime) return NextResponse.redirect(home);
  const res = NextResponse.redirect(new URL(`/film/${encodeURIComponent(showtime)}`, req.nextUrl.origin));
  res.cookies.set("ec_cmp", code, { maxAge: 7 * 86400, sameSite: "lax", httpOnly: true, secure: req.nextUrl.protocol === "https:", path: "/" });
  return res;
}
