import type { NextRequest } from "next/server";
import { cookies } from "next/headers";
import { accountApi, SESSION_COOKIE } from "@/lib/auth";
import { json, sameOrigin } from "@/lib/room-gate";

// Family and kids (Figma 89:1020). The Go API checks the parent PIN and which profile this
// device is using, so a kids profile cannot change its own controls or leave without the PIN.
export const dynamic = "force-dynamic";

const ID = /^[0-9a-f-]{36}$/;
const pass = (r: { status: number; body: unknown }) => json(r.status === 204 ? 200 : r.status, r.body ?? {});

async function session() {
  return (await cookies()).get(SESSION_COOKIE)?.value;
}

export async function GET(_req: NextRequest, ctx: { params: Promise<{ path?: string[] }> }) {
  const s = await session();
  if (!s) return json(401, { error: "Sign in first" });
  const path = (await ctx.params).path ?? [];
  if (path.length === 0) return pass(await accountApi("GET", "/v1/me/family", undefined, s));
  if (path.join("/") === "active") return pass(await accountApi("GET", "/v1/me/profile/active", undefined, s));
  return json(404, { error: "not found" });
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ path?: string[] }> }) {
  if (!sameOrigin(req)) return json(403, { error: "forbidden" });
  const s = await session();
  if (!s) return json(401, { error: "Sign in first" });
  const path = (await ctx.params).path ?? [];
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const str = (v: unknown, max = 200) => (typeof v === "string" ? v.slice(0, max) : "");
  const pin = str(b.pin, 6);
  const [a, id, action] = path;
  if (a === "switch" && !id) return pass(await accountApi("POST", "/v1/me/profile/switch", { profile: str(b.profile, 40), pin }, s));
  if (a === "ask" && !id) return pass(await accountApi("POST", "/v1/me/profile/ask", { what: str(b.what, 120), link: str(b.link, 300) }, s));
  if (a === "pin" && !id) return pass(await accountApi("POST", "/v1/me/family/pin", { current: str(b.current, 6), pin }, s));
  if (a === "profiles" && !id) return pass(await accountApi("POST", "/v1/me/family/profiles", { pin, profile: b.profile }, s));
  if (a === "profiles" && id && ID.test(id) && action === "remove") return pass(await accountApi("POST", `/v1/me/family/profiles/${id}/remove`, { pin }, s));
  if (a === "requests" && id && ID.test(id) && !action) return pass(await accountApi("POST", `/v1/me/family/requests/${id}`, { approve: b.approve === true }, s));
  return json(404, { error: "not found" });
}

export async function PUT(req: NextRequest, ctx: { params: Promise<{ path?: string[] }> }) {
  if (!sameOrigin(req)) return json(403, { error: "forbidden" });
  const s = await session();
  if (!s) return json(401, { error: "Sign in first" });
  const [a, id] = (await ctx.params).path ?? [];
  if (a !== "profiles" || !id || !ID.test(id)) return json(404, { error: "not found" });
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  return pass(await accountApi("PUT", `/v1/me/family/profiles/${id}`, { pin: typeof b.pin === "string" ? b.pin.slice(0, 6) : "", profile: b.profile }, s));
}
