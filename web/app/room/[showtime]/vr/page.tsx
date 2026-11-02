import Link from "next/link";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import VrCinema, { type Hall } from "@/components/room/VrCinema";
import type { Party } from "@/components/room/SidePanel";
import { accountApi, SESSION_COOKIE } from "@/lib/auth";
import { myTickets } from "@/lib/api";
import { filmStream, mediaEnabled } from "@/lib/media";
import { findShowtime } from "@/lib/catalog";

export const dynamic = "force-dynamic";
export const metadata = { title: "VR cinema · E-Cinema", robots: { index: false } };

type Room = {
  showtime: { id: string; film: string; studio: string; startsAt: string; durationMin: number };
  hasTicket: boolean;
  viewerCode?: string;
  watching?: number;
  party?: Party;
};

// VR and AR cinema mode (Figma 52:1122): the same synced screening, seen from a seat in a
// virtual hall. Open to holders of a VR seat for this premiere.
export default async function VrPage({ params }: { params: Promise<{ showtime: string }> }) {
  const { showtime } = await params;
  if (!/^[a-z0-9-]{1,80}$/.test(showtime)) notFound();
  const session = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!session) redirect(`/signin?next=/room/${showtime}/vr`);

  const r = await accountApi("GET", `/v1/rooms/${showtime}`, undefined, session);
  if (r.status === 401) redirect(`/signin?next=/room/${showtime}/vr`);
  if (r.status === 404) notFound();
  if (r.status !== 200) throw new Error(`room lookup failed: ${r.status}`);
  const room = r.body as Room;
  const film = findShowtime(showtime);

  const tickets = await myTickets(session).catch(() => []);
  const vrSeat = tickets.some((t) => t.showtimeId === showtime && t.status === "paid" && t.quality === "vr");
  if (!room.hasTicket || !vrSeat) {
    const flat = room.hasTicket;
    return (
      <section className="room-gate">
        <Link href="/" className="wordmark">E-CINEMA</Link>
        <h1>{room.showtime.film}</h1>
        <p className="muted">
          {film && !film.vr
            ? "This premiere is not shown in the VR cinema."
            : flat
              ? "Your seat is for the flat screen. The VR cinema is for VR seat holders."
              : "The VR cinema is for VR seat holders. Get one and you can come straight back in."}
        </p>
        <div className="vr-gate-acts">
          {film?.vr && <Link href={`/checkout?film=${showtime}&q=vr`} className="cta big">Get a VR seat</Link>}
          {flat && <Link href={`/room/${showtime}`} className="ghost big">Back to the watch room</Link>}
        </div>
      </section>
    );
  }

  const endsAt = new Date(new Date(room.showtime.startsAt).getTime() + room.showtime.durationMin * 60000);
  const stream = mediaEnabled ? await filmStream(endsAt) : null;
  const wsBase = (process.env.API_URL ?? "").replace(/^http/, "ws");
  // The halls published on the executive Rooms and VR halls page that this viewer may enter.
  const hr = await accountApi("GET", "/v1/me/rooms?kinds=vr,ar", undefined, session).catch(() => null);
  const halls = hr?.status === 200 ? (hr.body as Hall[]) : undefined;

  return (
    <VrCinema
      showtime={room.showtime}
      viewerCode={room.viewerCode ?? ""}
      initialWatching={room.watching ?? 0}
      party={room.party ?? null}
      wsBase={wsBase}
      halls={halls}
      film={stream ? { durationSec: stream.durationSec, credit: `Stand-in film: ${stream.title} ${stream.credit} · ${stream.license}` } : null}
    />
  );
}
