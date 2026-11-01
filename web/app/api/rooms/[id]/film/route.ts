import { NextResponse, type NextRequest } from "next/server";
import { filmRange, mediaEnabled } from "@/lib/media";
import { json, roomGate } from "@/lib/room-gate";

// GET /api/rooms/{id}/film?q=hd: the film for the VR cinema (Figma 52:1122), same origin so a
// headset can paint it on the virtual screen. Ticket holders only; ranges pass straight to R2.
export const dynamic = "force-dynamic";

const RANGE = /^bytes=\d*-\d*$/;

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const gate = await roomGate((await ctx.params).id);
  if (gate instanceof NextResponse) return gate;
  if (!mediaEnabled) return json(503, { error: "The film is not available yet" });
  const range = req.headers.get("range");
  if (range && !RANGE.test(range)) return json(416, { error: "Bad range" });
  const f = await filmRange(req.nextUrl.searchParams.get("q") === "sd" ? "sd" : "hd", range);
  if (!f) return json(404, { error: "The film is not available yet" });
  return new NextResponse(f.body, { status: f.status, headers: f.headers });
}
