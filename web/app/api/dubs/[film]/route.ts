import { NextResponse } from "next/server";
import { dubLanguages, dubTrack, FILM_ID, LANG, mediaEnabled } from "@/lib/media";

// GET /api/dubs/<film>            -> { languages }
// GET /api/dubs/<film>?lang=fr    -> { language, clips: [{ start, end, text, url }] } with 15-minute links
export async function GET(req: Request, { params }: { params: Promise<{ film: string }> }) {
  const { film } = await params;
  if (!FILM_ID.test(film)) return NextResponse.json({ error: "unknown film" }, { status: 404 });
  if (!mediaEnabled) return NextResponse.json({ error: "media storage is not configured" }, { status: 503 });
  const lang = new URL(req.url).searchParams.get("lang");
  try {
    if (!lang) return NextResponse.json({ languages: await dubLanguages(film) }, { headers: { "cache-control": "no-store" } });
    if (!LANG.test(lang)) return NextResponse.json({ error: "invalid language" }, { status: 400 });
    const clips = await dubTrack(film, lang);
    if (!clips) return NextResponse.json({ error: "no dub in that language" }, { status: 404 });
    return NextResponse.json({ language: lang, clips }, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    console.error("dub lookup failed", err);
    return NextResponse.json({ error: "could not load the dub" }, { status: 502 });
  }
}
