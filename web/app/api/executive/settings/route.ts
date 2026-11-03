import type { NextRequest } from "next/server";
import { accountApi } from "@/lib/auth";
import { session } from "@/lib/licensing";
import { json, sameOrigin } from "@/lib/room-gate";
import { refreshPlatform } from "@/lib/platform";

// PUT { key, value }: change one platform switch. The CEO only (the API checks and logs it).
export async function PUT(req: NextRequest) {
  if (!sameOrigin(req)) return json(403, { error: "forbidden" });
  const s = await session();
  if (!s) return json(401, { error: "Sign in first" });
  const b = (await req.json().catch(() => ({}))) as { key?: unknown; value?: unknown };
  if (typeof b.key !== "string" || (typeof b.value !== "boolean" && typeof b.value !== "string")) return json(400, { error: "Bad setting" });
  const r = await accountApi("PUT", "/v1/me/exec/settings", { key: b.key, value: b.value }, s);
  if (r.status === 200) await refreshPlatform(true);
  return json(r.status, r.body ?? {});
}
