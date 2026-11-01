import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { accountApi, SESSION_COOKIE } from "@/lib/auth";
import { json, sameOrigin } from "@/lib/room-gate";

// Collections in the Library (Figma 101:1208): create, rename, delete, add or remove films and
// share with friends. Each path shape maps to one Go route; anything else is refused.
export const dynamic = "force-dynamic";

const ID = /^[0-9a-f-]{36}$/;
const FILM = /^[a-z0-9-]{1,80}$/;

function allowed(method: string, p: string[]): boolean {
  if (p.length === 0) return method === "POST";
  if (!ID.test(p[0])) return false;
  if (p.length === 1) return method === "PUT" || method === "DELETE";
  if (p.length === 2) return p[1] === "shares" && method === "POST";
  return p.length === 3 && p[1] === "films" && FILM.test(p[2]) && (method === "PUT" || method === "DELETE");
}

async function handle(req: NextRequest, ctx: { params: Promise<{ path?: string[] }> }) {
  if (!sameOrigin(req)) return json(403, { error: "forbidden" });
  const p = (await ctx.params).path ?? [];
  if (!allowed(req.method, p)) return json(404, { error: "not found" });
  const session = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!session) return json(401, { error: "Sign in first" });
  const body = req.method === "POST" || (req.method === "PUT" && p.length === 1) ? await req.json().catch(() => ({})) : undefined;
  const r = await accountApi(req.method, `/v1/me/collections${p.length ? "/" + p.join("/") : ""}`, body, session);
  return r.status === 204 ? new NextResponse(null, { status: 204 }) : json(r.status, r.body ?? {});
}

export { handle as POST, handle as PUT, handle as DELETE };
