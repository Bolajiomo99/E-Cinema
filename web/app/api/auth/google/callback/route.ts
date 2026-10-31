import { NextResponse, type NextRequest } from "next/server";
import { accountApi, deviceLabel, SESSION_COOKIE } from "@/lib/auth";
import { finishGoogle, googleEnabled, siteUrl } from "@/lib/google";

export const dynamic = "force-dynamic";

type Session = { token: string; expiresAt: string; signedOut: number };

export async function GET(req: NextRequest) {
  const base = siteUrl(req.nextUrl.origin);
  const back = (error: string) => {
    const res = NextResponse.redirect(`${base}/signin?error=${error}`);
    res.cookies.delete({ name: "g_oauth", path: "/api/auth/google" });
    return res;
  };
  if (!googleEnabled) return back("google-off");
  const [state, verifier, nonce] = (req.cookies.get("g_oauth")?.value ?? "").split(".");
  const code = req.nextUrl.searchParams.get("code");
  if (!state || !code || req.nextUrl.searchParams.get("state") !== state) return back("google-failed");
  try {
    const id = await finishGoogle(base, code, verifier, nonce);
    const r = await accountApi("POST", "/v1/sessions/external", { provider: "google", ...id, device: await deviceLabel() });
    if (r.status !== 200) return back(r.status === 400 ? "google-email" : "google-failed");
    const { session, created } = r.body as { session: Session; created: boolean };
    const res = NextResponse.redirect(`${base}${created ? "/join" : session.signedOut ? "/settings/security?signedOut=1" : "/checkout"}`);
    res.cookies.delete({ name: "g_oauth", path: "/api/auth/google" });
    res.cookies.set(SESSION_COOKIE, session.token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      expires: new Date(session.expiresAt),
    });
    return res;
  } catch (e) {
    console.error("google sign-in failed", (e as Error).message);
    return back("google-failed");
  }
}
