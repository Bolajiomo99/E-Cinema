import type { NextRequest } from "next/server";
import { accountApi } from "@/lib/auth";
import { json, sameOrigin } from "@/lib/room-gate";

const release = process.env.RENDER_GIT_COMMIT ?? "";
const str = (v: unknown, n: number) => (typeof v === "string" ? v.slice(0, n) : "");

// POST { message, stack, path }: a crash in a viewer's browser. Forwarded to the API, which
// groups it and emails the tech team when it is new. Same-origin only; the API caps the rate.
export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return json(403, { error: "forbidden" });
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const message = str(b.message, 500);
  if (!message) return json(400, { error: "message required" });
  const r = await accountApi("POST", "/v1/errors", {
    source: "browser", message, stack: str(b.stack, 4000), path: str(b.path, 300),
    agent: (req.headers.get("user-agent") ?? "").slice(0, 300), release,
  }).catch(() => ({ status: 502, body: null }));
  return json(r.status === 200 ? 202 : r.status, {});
}
