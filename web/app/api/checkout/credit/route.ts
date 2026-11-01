import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { randomUUID } from "node:crypto";
import { holdSeats, myTickets, releaseHold, SoldOutError, AdultOnlyError } from "@/lib/api";
import { accountApi, SESSION_COOKIE } from "@/lib/auth";
import { findShowtime } from "@/lib/catalog";
import { quote } from "@/lib/ticket-quote";

// Pays a seat from gift credit instead of PayPal. The price comes from the server catalog, as at checkout.
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const origin = req.headers.get("origin");
  if (origin && new URL(origin).host !== req.headers.get("host")) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const session = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!session) return NextResponse.json({ error: "Sign in first", signIn: true }, { status: 401 });
  const b = (await req.json().catch(() => ({}))) as { showtimeId?: string; quality?: string };
  const s = findShowtime(b.showtimeId ?? "");
  if (!s || s.adult) return NextResponse.json({ error: "This premiere cannot be paid with credit" }, { status: 400 });
  const prof = await accountApi("GET", "/v1/me/profile", undefined, session).catch(() => null);
  const q = quote(s, prof?.status === 200 ? (prof.body as { plan?: string; planStatus?: string; country?: string }) : undefined, Date.now(), b.quality);
  if (q.phase === "ended") return NextResponse.json({ error: "This premiere has ended" }, { status: 410 });
  if (q.currency !== "USD") return NextResponse.json({ error: "Credit pays for seats priced in US dollars" }, { status: 400 });
  const cents = Math.round(Number(q.total) * 100);
  const net = Math.round((Number(q.seat) + Number(q.late) - Number(q.discount)) * 100);
  try {
    const stale = (await myTickets(session).catch(() => [])).filter((t) => t.showtimeId === s.id && t.status === "held");
    await Promise.all(stale.map((t) => releaseHold(session, t.holdId).catch(() => undefined)));
    const hold = await holdSeats(s.id, 1, randomUUID(), session, q.quality);
    if (!hold) return NextResponse.json({ error: "Seats are not available here" }, { status: 503 });
    const r = await accountApi("POST", `/v1/me/holds/${hold.id}/credit`, { cents, netCents: net }, session);
    if (r.status !== 204) {
      await releaseHold(session, hold.id).catch(() => undefined);
      return NextResponse.json({ error: (r.body as { error?: string })?.error ?? "Could not pay with credit" }, { status: r.status === 402 ? 402 : 409 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof SoldOutError) return NextResponse.json({ error: "Sold out" }, { status: 409 });
    if (err instanceof AdultOnlyError) return NextResponse.json({ error: "Verified adults only" }, { status: 403 });
    throw err;
  }
}
