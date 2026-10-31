import { NextResponse } from "next/server";
import { findShowtime } from "@/lib/catalog";
import { shopFor } from "@/lib/shop";

// GET /api/shop?showtime=<id> returns products inspired by that film.
export async function GET(req: Request) {
  const showtime = findShowtime(new URL(req.url).searchParams.get("showtime") ?? "");
  if (!showtime) return NextResponse.json({ error: "Unknown showtime" }, { status: 400 });
  try {
    return NextResponse.json({ film: showtime.film, items: await shopFor(showtime.shopQuery) });
  } catch (err) {
    console.error("Shop error", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Shop unavailable" }, { status: 502 });
  }
}
