import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { findShowtime } from "@/lib/catalog";
import { SESSION_COOKIE } from "@/lib/auth";
import { createSeatOrder } from "@/lib/seat-order";

// Creates a PayPal order for one ticket. Adult titles go through the four-stage unlock instead.
export async function POST(req: Request) {
  const { showtimeId, quality } = (await req.json().catch(() => ({}))) as { showtimeId?: string; quality?: string };
  const showtime = showtimeId ? findShowtime(showtimeId) : undefined;
  if (!showtime) return NextResponse.json({ error: "Unknown showtime" }, { status: 400 });
  if (showtime.adult) return NextResponse.json({ error: "Adult titles unlock in four stages", unlock: `/unlock/${showtime.id}` }, { status: 409 });
  return createSeatOrder(showtime, (await cookies()).get(SESSION_COOKIE)?.value, quality);
}
