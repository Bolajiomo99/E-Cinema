import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { accountApi, SESSION_COOKIE } from "@/lib/auth";

export const dynamic = "force-dynamic";

// PUT /api/me/plan: the plan picked at sign-up. Paid plans stay "awaiting payment" until paid.
export async function PUT(req: NextRequest) {
  const origin = req.headers.get("origin");
  if (origin && new URL(origin).host !== req.headers.get("host")) return NextResponse.json({ error: "cross-site request" }, { status: 403 });
  const session = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!session) return NextResponse.json({ error: "sign in first" }, { status: 401 });
  const { plan } = (await req.json().catch(() => ({}))) as { plan?: string };
  const r = await accountApi("PUT", "/v1/me/plan", { plan: String(plan ?? "") }, session);
  return NextResponse.json(r.body, { status: r.status });
}
