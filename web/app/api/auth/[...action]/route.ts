import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { accountApi, deviceLabel, SESSION_COOKIE } from "@/lib/auth";
import { emailEnabled, sendEmailConfirm, sendLoginCode, sendNewSignIn, sendPasswordChanged, sendResetCode } from "@/lib/email";
import { timesLeaked } from "@/lib/pwned";
import { countryName } from "@/lib/plans";

const RESET_COOKIE = process.env.NODE_ENV === "production" ? "__Host-ecr" : "ecr";

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

// Issues the email confirmation code and emails it. Smoke-test accounts get no mail.
async function mailEmailCode(session: string): Promise<{ ok: true; sentTo: string } | { ok: false; status: number; error: string }> {
  const r = await accountApi("POST", "/v1/me/email/code", {}, session);
  const out = r.body as { code?: string; email?: string; maskedTo?: string; error?: string } | null;
  if (r.status !== 200 || !out?.code || !out.email) return { ok: false, status: r.status === 200 ? 502 : r.status, error: out?.error || "We could not make a code just now" };
  if (/^smoke\+.*@e-cinema\.net$/i.test(out.email)) return { ok: true, sentTo: out.maskedTo ?? "" };
  if (!emailEnabled) {
    if (process.env.E2E_LOG_CODES) console.log(`[e2e] email code for ${out.email}: ${out.code}`);
    return { ok: true, sentTo: out.maskedTo ?? "" };
  }
  try { await sendEmailConfirm(out.email, out.code); } catch { return { ok: false, status: 502, error: "We could not send your code just now. Please try again in a minute." }; }
  return { ok: true, sentTo: out.maskedTo ?? "" };
}

const relay = (r: { status: number; body: unknown }) => json(r.status, r.body);

// Puts the session token in an httpOnly cookie and keeps it out of the JSON page scripts can read.
// keep=false gives a browser-session cookie ("Keep me signed in" unticked).
function withSession(r: { status: number; body: unknown }, keep = true) {
  const body = r.body as { session?: Session } | null;
  const s = body?.session;
  if (!s?.token) return relay(r);
  const res = json(r.status, { ...body, session: { expiresAt: s.expiresAt, signedOut: s.signedOut } });
  res.cookies.set(SESSION_COOKIE, s.token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    ...(keep ? { expires: new Date(s.expiresAt) } : {}),
  });
  return res;
}

// Sends the "New sign-in" email when the API flags a new device, and keeps the lock token
// out of what the browser sees.
async function signedIn(req: NextRequest, r: { status: number; body: unknown }, keep = true) {
  const body = r.body as { account?: { email: string }; lockToken?: string } | null;
  if (r.status === 200 && body?.lockToken && body.account && emailEnabled) {
    try {
      await sendNewSignIn(body.account.email, body.lockToken, await where(req));
    } catch {}
  }
  if (body && "lockToken" in body) delete body.lockToken;
  return withSession(r, keep);
}

type Issued = { found: boolean; code?: string; email?: string; name?: string; phone?: string; maskedTo: string };

// Sends a one-time code. The answer looks the same whether or not the account exists.
async function where(req: NextRequest) {
  const cc = req.headers.get("cf-ipcountry") ?? "";
  return { device: await deviceLabel(), place: /^[A-Z]{2}$/.test(cc) && cc !== "XX" ? countryName(cc) : "" };
}

async function issueCode(req: NextRequest, identifier: string, purpose: "login" | "reset") {
  if (!emailEnabled && process.env.NODE_ENV === "production" && !process.env.E2E_LOG_CODES) {
    return json(503, { error: "Codes by email are being switched on. Please use your password or a passkey for now." });
  }
  const r = await accountApi("POST", "/v1/codes", { identifier, purpose });
  if (r.status !== 200) return relay(r);
  const out = r.body as Issued;
  const channel = out.phone ? "sms" : out.found || identifier.includes("@") ? "email" : "sms";
  if (out.found && out.code && out.email) {
    if (emailEnabled) {
      try {
        if (purpose === "login") await sendLoginCode(out.email, out.code, await where(req));
        else await sendResetCode(out.email, out.code, identifier, await where(req));
      } catch {
        return json(502, { error: "We could not send the email just now. Please try again in a minute." });
      }
    } else if (process.env.E2E_LOG_CODES) {
      console.log(`[e2e] ${purpose} code for ${out.email}: ${out.code}`);
    }
  }
  return json(200, { sentTo: out.maskedTo, channel });
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ action: string[] }> }) {
  const action = (await params).action.join("/");
  const session = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!session) return json(401, { error: "not signed in" });
  if (action === "me") return relay(await accountApi("GET", "/v1/sessions/current", undefined, session));
  if (action === "devices") return relay(await accountApi("GET", "/v1/devices", undefined, session));
  if (action === "passkeys") return relay(await accountApi("GET", "/v1/passkeys", undefined, session));
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
    {
      const r = await accountApi("POST", "/v1/accounts", { email: b.email, name: b.name, password: b.password, device });
      const token = (r.body as { session?: Session } | null)?.session?.token;
      // Email 02: the code that confirms the address goes out straight away; the Verify step asks for it.
      if (r.status >= 200 && r.status < 300 && token) await mailEmailCode(token);
      return withSession(r);
    }
    case "signin": {
      const r = await accountApi("POST", "/v1/sessions", { email: b.email, password: b.password, device });
      if (r.status === 202) {
        // Two-step verification: email the code (texts go out from the API).
        const out = r.body as { code: Issued; identifier: string };
        if (out.code.code && out.code.email) {
          if (emailEnabled) {
            try {
              await sendLoginCode(out.code.email, out.code.code, await where(req));
            } catch {
              return json(502, { error: "We could not send your code just now. Please try again in a minute." });
            }
          } else if (process.env.E2E_LOG_CODES) console.log(`[e2e] login code for ${out.code.email}: ${out.code.code}`);
        }
        return json(202, { secondStep: true, identifier: out.identifier, sentTo: out.code.maskedTo, channel: out.code.phone ? "sms" : "email" });
      }
      return signedIn(req, r, b.keep !== false);
    }
    case "codes":
      if (typeof b.identifier !== "string" || (b.purpose !== "login" && b.purpose !== "reset")) return json(400, { error: "Enter your email or mobile number" });
      return issueCode(req, b.identifier, b.purpose);
    case "codes/login":
      return signedIn(req, await accountApi("POST", "/v1/codes/login", { identifier: b.identifier, code: b.code, device }), b.keep !== false);
    case "codes/reset": {
      const r = await accountApi("POST", "/v1/codes/reset", { identifier: b.identifier, code: b.code });
      if (r.status !== 200) return relay(r);
      const res = json(200, { ok: true });
      res.cookies.set(RESET_COOKIE, (r.body as { resetToken: string }).resetToken, {
        httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "strict", path: "/", maxAge: 15 * 60,
      });
      return res;
    }
    case "password/check": {
      if (typeof b.password !== "string" || b.password.length < 4) return json(200, { leaked: null });
      const n = await timesLeaked(b.password);
      return json(200, { leaked: n === null ? null : n > 0 });
    }
    case "password/reset": {
      const token = (await cookies()).get(RESET_COOKIE)?.value;
      if (!token) return json(410, { error: "That reset has expired. Please ask for a new code." });
      if (typeof b.password !== "string" || b.password.length < 12) return json(400, { error: "Your new password needs at least 12 characters" });
      if (b.password !== b.confirm) return json(400, { error: "The two passwords do not match" });
      if (((await timesLeaked(b.password)) ?? 0) > 0) {
        return json(400, { error: "This password has shown up in a data leak on another site. Please choose a different one." });
      }
      const r = await accountApi("POST", "/v1/password/reset", { token, password: b.password, device, signOutOthers: b.signOutOthers !== false });
      if (r.status !== 200) return relay(r);
      const out = r.body as { account: { email: string; name: string }; session: Session; lockToken: string; signedOutOthers: number };
      let emailed = false;
      if (emailEnabled) {
        try {
          await sendPasswordChanged(out.account.email, out.lockToken, out.signedOutOthers, await where(req));
          emailed = true;
        } catch {}
      }
      const res = withSession({ status: 200, body: { account: out.account, session: out.session, signedOutOthers: out.signedOutOthers, emailed } });
      res.cookies.delete(RESET_COOKIE);
      return res;
    }
    case "password/lock": {
      const r = await accountApi("POST", "/v1/password/lock", { token: b.token });
      if (r.status !== 200) return relay(r);
      const res = json(200, { ok: true });
      res.cookies.delete(SESSION_COOKIE);
      return res;
    }
    case "signout": {
      if (session) await accountApi("DELETE", "/v1/sessions/current", undefined, session);
      const res = json(200, { ok: true });
      res.cookies.delete(SESSION_COOKIE);
      return res;
    }
    case "email/code": {
      if (!session) return json(401, { error: "not signed in" });
      const sent = await mailEmailCode(session);
      return sent.ok ? json(200, { sentTo: sent.sentTo }) : json(sent.status, { error: sent.error });
    }
    case "email/confirm":
      if (!session) return json(401, { error: "not signed in" });
      return relay(await accountApi("POST", "/v1/me/email/confirm", { code: b.code }, session));
    case "phone":
      if (!session) return json(401, { error: "not signed in" });
      return relay(await accountApi("POST", "/v1/phone", { phone: b.phone }, session));
    case "phone/confirm":
      if (!session) return json(401, { error: "not signed in" });
      return relay(await accountApi("POST", "/v1/phone/confirm", { code: b.code }, session));
    case "passkeys/login/begin":
      return relay(await accountApi("POST", "/v1/passkeys/login/begin", {}));
    case "passkeys/login/finish":
      return signedIn(req, await accountApi("POST", "/v1/passkeys/login/finish", { challengeId: b.challengeId, credential: b.credential, device }));
    case "passkeys/register/begin":
      if (!session) return json(401, { error: "not signed in" });
      return relay(await accountApi("POST", "/v1/passkeys/register/begin", {}, session));
    case "passkeys/register/finish":
      if (!session) return json(401, { error: "not signed in" });
      return relay(await accountApi("POST", "/v1/passkeys/register/finish", { challengeId: b.challengeId, credential: b.credential, name: device }, session));
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
  if (kind === "passkeys" && id && /^[0-9a-f]{2,1000}$/.test(id)) {
    return relay(await accountApi("DELETE", `/v1/passkeys/${id}`, undefined, session));
  }
  return json(404, { error: "not found" });
}
