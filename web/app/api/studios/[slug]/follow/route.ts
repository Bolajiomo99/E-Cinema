import { cookies } from "next/headers";
import { accountApi, SESSION_COOKIE } from "@/lib/auth";
import { json, sameOrigin } from "@/lib/room-gate";

// PUT /api/studios/<slug>/follow {on}: follow a studio to hear about its new premieres.
export async function PUT(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  if (!sameOrigin(req)) return json(403, { error: "forbidden" });
  const { slug } = await params;
  if (!/^[a-z0-9-]{1,90}$/.test(slug)) return json(404, { error: "Not found" });
  const session = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!session) return json(401, { error: "Sign in to follow studios", signIn: true });
  const b = (await req.json().catch(() => ({}))) as { on?: unknown };
  const r = await accountApi("PUT", `/v1/me/studio-follows/${slug}`, { On: b.on === true }, session);
  return json(r.status, r.body ?? {});
}
