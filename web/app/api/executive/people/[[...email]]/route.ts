import type { NextRequest } from "next/server";
import { accountApi, currentAccount } from "@/lib/auth";
import { session } from "@/lib/licensing";
import { json, sameOrigin } from "@/lib/room-gate";
import { emailEnabled, sendExecInvite } from "@/lib/email";
import { ROLE_LABEL } from "@/lib/exec-types";

// Access and roles (Figma 49:1307): the API decides who may grant; this only relays and emails.
export const dynamic = "force-dynamic";
const pass = (r: { status: number; body: unknown }) => json(r.status, r.body ?? {});

export async function GET() {
  const s = await session();
  if (!s) return json(401, { error: "Sign in first" });
  return pass(await accountApi("GET", "/v1/me/exec/people", undefined, s));
}

export async function PUT(req: NextRequest) {
  if (!sameOrigin(req)) return json(403, { error: "forbidden" });
  const s = await session();
  const me = await currentAccount();
  if (!s || !me) return json(401, { error: "Sign in first" });
  const body = (await req.json().catch(() => null)) as { email?: string; name?: string; role?: string; expiresOn?: string; invite?: boolean } | null;
  if (!body) return json(400, { error: "Bad request" });
  const r = await accountApi("PUT", `/v1/me/exec/people${body.invite ? "?invite=1" : ""}`, body, s);
  if (r.status !== 200) return pass(r);
  let emailed = false;
  const token = String((r.body as { invite?: string }).invite ?? "");
  // New people get the invite; a change only emails when the CEO asks for it again.
  if (emailEnabled && ((r.body as { added?: boolean }).added || body.invite)) {
    try {
      await sendExecInvite(String(body.email).trim().toLowerCase(), String(body.name ?? ""), ROLE_LABEL[String(body.role)] ?? "Executive", me.name || "The CEO", String(body.expiresOn ?? ""), token);
      emailed = true;
    } catch { /* access is granted either way; the page says the email did not go */ }
  } else if (token && process.env.E2E_LOG_CODES) console.log(`[e2e] exec invite for ${String(body.email).trim().toLowerCase()}: /invite/executive/${token}`);
  const { invite: _drop, ...rest } = r.body as { invite?: string };
  void _drop;
  return json(200, { ...rest, emailed });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ email?: string[] }> }) {
  if (!sameOrigin(req)) return json(403, { error: "forbidden" });
  const s = await session();
  if (!s) return json(401, { error: "Sign in first" });
  const e = (await params).email ?? [];
  if (e.length !== 1 || !e[0].includes("@")) return json(404, { error: "Not found" });
  const r = await accountApi("DELETE", `/v1/me/exec/people/${encodeURIComponent(decodeURIComponent(e[0]))}`, undefined, s);
  return r.status === 204 ? new Response(null, { status: 204 }) : pass(r);
}
