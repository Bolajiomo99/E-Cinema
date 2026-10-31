import "server-only";
import { createHash, randomBytes } from "node:crypto";

// Google sign-in (OpenID Connect, authorization code + PKCE). Off until both env vars are set.
const clientId = process.env.GOOGLE_CLIENT_ID;
const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
export const googleEnabled = Boolean(clientId && clientSecret);

export function siteUrl(fallback: string) {
  return (process.env.WEB_URL || fallback).replace(/\/$/, "");
}

const b64url = (b: Buffer) => b.toString("base64url");

export function startGoogle(base: string) {
  const state = b64url(randomBytes(24));
  const verifier = b64url(randomBytes(32));
  const nonce = b64url(randomBytes(16));
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.search = new URLSearchParams({
    client_id: clientId!,
    redirect_uri: `${base}/api/auth/google/callback`,
    response_type: "code",
    scope: "openid email profile",
    state,
    nonce,
    code_challenge: b64url(createHash("sha256").update(verifier).digest()),
    code_challenge_method: "S256",
    prompt: "select_account",
  }).toString();
  return { url: url.toString(), cookie: `${state}.${verifier}.${nonce}` };
}

export type GoogleIdentity = { subject: string; email: string; emailVerified: boolean; name: string };

// The ID token comes straight from Google's token endpoint over TLS, so per OpenID Connect
// we check its claims (issuer, audience, expiry, nonce) rather than re-verifying the signature.
export async function finishGoogle(base: string, code: string, verifier: string, nonce: string): Promise<GoogleIdentity> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId!,
      client_secret: clientSecret!,
      redirect_uri: `${base}/api/auth/google/callback`,
      grant_type: "authorization_code",
      code_verifier: verifier,
    }),
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`google token ${res.status}`);
  const { id_token } = (await res.json()) as { id_token?: string };
  if (!id_token) throw new Error("google sent no id token");
  const claims = JSON.parse(Buffer.from(id_token.split(".")[1], "base64url").toString("utf8"));
  const issOk = claims.iss === "https://accounts.google.com" || claims.iss === "accounts.google.com";
  if (!issOk || claims.aud !== clientId || claims.exp * 1000 < Date.now() || claims.nonce !== nonce) {
    throw new Error("google id token failed checks");
  }
  return { subject: String(claims.sub), email: String(claims.email ?? ""), emailVerified: claims.email_verified === true, name: String(claims.name ?? "") };
}
