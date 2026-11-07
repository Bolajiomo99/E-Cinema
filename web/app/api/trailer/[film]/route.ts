import { NextResponse } from "next/server";
import { findShowtime } from "@/lib/catalog";
import { FILM_ID, mediaEnabled, trailer } from "@/lib/media";
import { recordView } from "@/lib/views";

export const dynamic = "force-dynamic";

// GET /api/trailer/<showtime id>: a short-lived signed link to the trailer.
export async function GET(req: Request, { params }: { params: Promise<{ film: string }> }) {
  const { film } = await params;
  if (!FILM_ID.test(film) || !findShowtime(film)) return NextResponse.json({ error: "Unknown film" }, { status: 404 });
  if (!mediaEnabled) return NextResponse.json({ error: "Trailers are not switched on here" }, { status: 503 });
  try {
    const t = await trailer(film);
    if (!t) return NextResponse.json({ error: "No trailer yet" }, { status: 404 });
    // Counts as "Saw a clip" in the studio ticket funnel, once per visitor per day.
    await recordView(req, film, "clip");
    return NextResponse.json(t, { headers: { "Cache-Control": "private, max-age=300" } });
  } catch {
    return NextResponse.json({ error: "Trailer unavailable" }, { status: 502 });
  }
}
