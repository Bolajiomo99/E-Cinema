import Link from "next/link";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import WatchRoom, { type RoomMessage } from "@/components/WatchRoom";
import { accountApi, SESSION_COOKIE } from "@/lib/auth";
import { filmStream, mediaEnabled } from "@/lib/media";

export const dynamic = "force-dynamic";
export const metadata = { title: "Watch room · E-Cinema", robots: { index: false } };

type Room = {
  showtime: { id: string; film: string; studio: string; startsAt: string; durationMin: number };
  hasTicket: boolean;
  messages?: RoomMessage[];
  viewerCode?: string;
  watching?: number;
};

export default async function RoomPage({ params }: { params: Promise<{ showtime: string }> }) {
  const { showtime } = await params;
  if (!/^[a-z0-9-]{1,80}$/.test(showtime)) notFound();
  const session = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!session) redirect(`/signin?next=/room/${showtime}`);

  const r = await accountApi("GET", `/v1/rooms/${showtime}`, undefined, session);
  if (r.status === 401) redirect(`/signin?next=/room/${showtime}`);
  if (r.status === 404) notFound();
  if (r.status !== 200) throw new Error(`room lookup failed: ${r.status}`);
  const room = r.body as Room;

  if (!room.hasTicket) {
    return (
      <section className="room-gate">
        <Link href="/" className="wordmark">E-CINEMA</Link>
        <h1>{room.showtime.film}</h1>
        <p className="muted">This room is for ticket holders. Get a seat and you can come straight back in.</p>
        <Link href={`/checkout?film=${room.showtime.id}`} className="cta big">Get a seat</Link>
      </section>
    );
  }

  const endsAt = new Date(new Date(room.showtime.startsAt).getTime() + room.showtime.durationMin * 60000);
  const stream = mediaEnabled ? await filmStream(endsAt) : null;
  const wsBase = (process.env.API_URL ?? "").replace(/^http/, "ws");

  return (
    <WatchRoom
      showtime={room.showtime}
      viewerCode={room.viewerCode ?? ""}
      initialMessages={room.messages ?? []}
      initialWatching={room.watching ?? 0}
      stream={stream}
      wsBase={wsBase}
    />
  );
}
