import { NextResponse } from "next/server";
import { liveStats } from "@/lib/api";

export const dynamic = "force-dynamic";

// GET /api/live: how many people are in each room right now, and from how many countries.
export async function GET() {
  return NextResponse.json(await liveStats(), { headers: { "Cache-Control": "public, max-age=5" } });
}
