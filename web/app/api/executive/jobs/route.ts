import type { NextRequest } from "next/server";
import { accountApi } from "@/lib/auth";
import { session } from "@/lib/licensing";
import { json, sameOrigin } from "@/lib/room-gate";

// PUT: post or edit a role from the executive Hiring page (the API checks who may).
export async function PUT(req: NextRequest) {
  if (!sameOrigin(req)) return json(403, { error: "forbidden" });
  const s = await session();
  if (!s) return json(401, { error: "Sign in first" });
  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const slug = String(b?.slug ?? "");
  if (!b || !/^[a-z0-9-]{3,80}$/.test(slug)) return json(400, { error: "Give the role a title" });
  const str = (k: string) => String(b[k] ?? "");
  const r = await accountApi("PUT", `/v1/me/exec/jobs/${slug}`, {
    title: str("title"), team: str("team"), city: str("city"), country: str("country"), remote: b.remote === true, kind: str("kind"),
    quota: str("quota"), pay: str("pay"), setup: str("setup"), about: str("about"), bring: str("bring"), open: true,
  }, s);
  return json(r.status, r.body ?? {});
}
