import { NextResponse } from "next/server";
import { tonightAudience } from "@/lib/api";

export const dynamic = "force-dynamic";

// GET /api/audience/tonight: seats booked for the next 24 hours, by home country.
export async function GET() {
  return NextResponse.json(await tonightAudience(), { headers: { "Cache-Control": "public, max-age=30" } });
}
