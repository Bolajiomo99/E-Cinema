import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { accountApi, SESSION_COOKIE } from "@/lib/auth";

export const dynamic = "force-dynamic";

// POST /api/classics { title, year }: suggest a film that is not in a vault yet.
export async function POST(req: NextRequest) {
  const origin = req.headers.get("origin");
  if (origin && new URL(origin).host !== req.headers.get("host")) return NextResponse.json({ error: "cross-site request" }, { status: 403 });
  const session = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!session) return NextResponse.json({ error: "Sign in first" }, { status: 401 });
  const b = await req.json().catch(() => ({}));
  const r = await accountApi("POST", "/v1/classics", { title: String(b.title ?? "").slice(0, 100), year: Number(b.year) || 0 }, session);
  return NextResponse.json(r.body, { status: r.status });
}
