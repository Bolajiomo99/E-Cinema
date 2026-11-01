import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { accountApi, SESSION_COOKIE } from "@/lib/auth";

// Claims a gift for the signed-in viewer.
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  const origin = req.headers.get("origin");
  if (origin && new URL(origin).host !== req.headers.get("host")) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const session = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!session) return NextResponse.json({ error: "Sign in to claim your gift", signIn: true }, { status: 401 });
  const { code } = await params;
  if (!/^ECG-[A-Z0-9]{4}-[A-Z0-9]{4}$/i.test(code)) return NextResponse.json({ error: "That is not a gift code" }, { status: 400 });
  const r = await accountApi("POST", `/v1/gifts/${encodeURIComponent(code.toUpperCase())}/redeem`, {}, session);
  return NextResponse.json(r.body ?? {}, { status: r.status });
}
