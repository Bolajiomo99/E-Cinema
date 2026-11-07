import "server-only";
import { cookies, headers } from "next/headers";

// Accounts live in the Go API. The browser only ever holds an httpOnly session cookie;
// the web server forwards it to the API with the internal token.
const base = process.env.API_URL;
const token = process.env.INTERNAL_API_TOKEN;
export const authEnabled = Boolean(base && token);

export const SESSION_COOKIE = process.env.NODE_ENV === "production" ? "__Host-ecs" : "ecs";

export type Account = {
  id: string;
  email: string;
  name: string;
  phone?: string;
  phoneVerified: boolean;
  faceVerified: boolean;
  idVerified: boolean;
  emailVerified?: boolean;
  createdAt: string;
};

export type ApiResult = { status: number; body: unknown };

export async function accountApi(method: string, path: string, body?: unknown, session?: string): Promise<ApiResult> {
  if (!authEnabled) return { status: 503, body: { error: "Accounts are not switched on here" } };
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(session ? { "X-Session-Token": session } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(10000),
    cache: "no-store",
  });
  return { status: res.status, body: res.status === 204 ? null : await res.json().catch(() => null) };
}

// The signed-in viewer for server components, or null.
export async function currentAccount(): Promise<Account | null> {
  const session = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!session || !authEnabled) return null;
  const r = await accountApi("GET", "/v1/sessions/current", undefined, session);
  return r.status === 200 ? (r.body as { account: Account }).account : null;
}

// A short, human label for the devices list, e.g. "Chrome on Mac".
export async function deviceLabel(): Promise<string> {
  const ua = (await headers()).get("user-agent") ?? "";
  const browser = /Edg\//.test(ua) ? "Edge" : /OPR\//.test(ua) ? "Opera" : /Firefox\//.test(ua) ? "Firefox"
    : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "Browser";
  const os = /iPhone|iPad/.test(ua) ? "iPhone" : /Android/.test(ua) ? "Android" : /Mac OS X/.test(ua) ? "Mac"
    : /Windows/.test(ua) ? "Windows" : /Linux/.test(ua) ? "Linux" : "device";
  return `${browser} on ${os}`;
}
