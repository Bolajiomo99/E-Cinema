import { cookies } from "next/headers";
import { accountApi, SESSION_COOKIE } from "@/lib/auth";
import { json, sameOrigin } from "@/lib/room-gate";

// Notifications (Figma 31:878): GET /api/notifications[?category=], GET /api/notifications/unread,
// POST /api/notifications/{id|all}/read.
type Ctx = { params: Promise<{ path?: string[] }> };

async function session() {
  return (await cookies()).get(SESSION_COOKIE)?.value;
}

export async function GET(req: Request, { params }: Ctx) {
  const s = await session();
  if (!s) return json(401, { error: "Sign in first" });
  const path = (await params).path ?? [];
  if (path.length === 1 && path[0] === "unread") {
    const r = await accountApi("GET", "/v1/me/notifications/unread", undefined, s);
    return json(r.status, r.body ?? {});
  }
  if (path.length) return json(404, { error: "not found" });
  const cat = new URL(req.url).searchParams.get("category") ?? "";
  if (!/^(|all|premieres|social|payments)$/.test(cat)) return json(400, { error: "bad category" });
  const r = await accountApi("GET", `/v1/me/notifications?category=${cat}`, undefined, s);
  return json(r.status, r.body ?? {});
}

export async function POST(req: Request, { params }: Ctx) {
  if (!sameOrigin(req)) return json(403, { error: "forbidden" });
  const s = await session();
  if (!s) return json(401, { error: "Sign in first" });
  const path = (await params).path ?? [];
  if (path.length !== 2 || path[1] !== "read" || !/^(all|[1-9][0-9]{0,18})$/.test(path[0])) return json(404, { error: "not found" });
  const r = await accountApi("POST", `/v1/me/notifications/${path[0]}/read`, {}, s);
  return json(r.status, r.body ?? {});
}
