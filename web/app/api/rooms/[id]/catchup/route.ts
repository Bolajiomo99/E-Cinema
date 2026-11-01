import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { catchUp, speak } from "@/lib/catchup";
import { json, roomGate } from "@/lib/room-gate";

// GET -> the catch-up for this moment; GET ?audio=1 -> the same read aloud (mp3).
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const g = await roomGate((await params).id);
  if (g instanceof NextResponse) return g;
  const minutes = Math.floor((Date.now() - g.startsAt) / 60000);
  if (minutes < 1) return json(409, { error: "The film has not started yet" });
  const c = await catchUp(g.s, minutes, g.lang);
  if (req.nextUrl.searchParams.get("audio") !== "1") return json(200, { ...c, readSec: Math.max(10, Math.round(c.text.split(/\s+/).length / 3.3)) });
  if (!process.env.ELEVENLABS_API_KEY) return json(503, { error: "Listening is paused right now" });
  try {
    const mp3 = await speak(c.text);
    return new NextResponse(new Uint8Array(mp3), { headers: { "content-type": "audio/mpeg", "cache-control": "private, max-age=300" } });
  } catch (err) {
    console.error("catch-up audio failed", (err as Error).message);
    return json(502, { error: "Could not read it aloud right now" });
  }
}
