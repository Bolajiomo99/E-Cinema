import { NextResponse, type NextRequest } from "next/server";
import { search } from "@/lib/search";

export const dynamic = "force-dynamic";

// A small per-address limit keeps AI search costs bounded.
const seen = new Map<string, number[]>();
function allowed(ip: string) {
  const now = Date.now();
  const list = (seen.get(ip) ?? []).filter((t) => now - t < 60_000);
  list.push(now);
  seen.set(ip, list);
  if (seen.size > 5000) seen.delete(seen.keys().next().value!);
  return list.length <= 30;
}

// GET /api/search?q=anime+about+friendship+this+weekend
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q") ?? "";
  const ip = req.headers.get("cf-connecting-ip") ?? req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  if (!allowed(ip)) return NextResponse.json({ error: "Too many searches. Try again in a minute." }, { status: 429 });
  return NextResponse.json(await search(q), { headers: { "Cache-Control": "no-store" } });
}
