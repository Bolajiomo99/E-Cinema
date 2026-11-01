import Link from "next/link";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import WatchRoom, { type RoomMessage } from "@/components/WatchRoom";
import type { Party, Poll } from "@/components/room/SidePanel";
import { accountApi, SESSION_COOKIE } from "@/lib/auth";
import { myTickets } from "@/lib/api";
import { dubLanguages, filmStream, mediaEnabled } from "@/lib/media";
import { findShowtime } from "@/lib/catalog";
import { langName } from "@/lib/i18n";
import { readLocale } from "@/lib/locale";

export const dynamic = "force-dynamic";
export const metadata = { title: "Watch room · E-Cinema", robots: { index: false } };

type Room = {
  showtime: { id: string; film: string; studio: string; startsAt: string; durationMin: number };
  hasTicket: boolean;
  messages?: RoomMessage[];
  viewerCode?: string;
  watching?: number;
  party?: Party;
  roomMessages?: RoomMessage[];
  polls?: Poll[];
  talkLeft?: number;
  lang?: string;
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
  // The lobby shows how the viewer will hear and read the film.
  const [prof, loc, rev, tickets] = await Promise.all([
    accountApi("GET", "/v1/me/profile", undefined, session).catch(() => null),
    readLocale(),
    accountApi("GET", `/v1/me/reviews/${showtime}`, undefined, session).catch(() => null),
    myTickets(session).catch(() => []),
  ]);
  const pref = (prof?.status === 200 ? (prof.body as { audioLanguage?: string }).audioLanguage : undefined) || "";
  const original = findShowtime(showtime)?.language ?? "English";
  const audio = pref && langName(pref) !== original ? `${langName(pref)} (AI)` : original;
  // AI dubs and subtitles: the film's own tracks, or the stand-in's while it plays in its place.
  let dubFilm = showtime;
  let dubLangs: string[] = [];
  if (mediaEnabled) {
    dubLangs = await dubLanguages(showtime).catch(() => []);
    if (!dubLangs.length && stream) {
      dubFilm = "stand-in";
      dubLangs = await dubLanguages(dubFilm).catch(() => []);
    }
  }

  return (
    <WatchRoom
      showtime={room.showtime}
      viewerCode={room.viewerCode ?? ""}
      initialMessages={room.messages ?? []}
      initialWatching={room.watching ?? 0}
      stream={stream}
      wsBase={wsBase}
      audio={audio}
      subtitles={langName(loc.lang)}
      party={room.party ?? null}
      initialRoomMessages={room.roomMessages ?? []}
      initialPolls={room.polls ?? []}
      initialTalkLeft={room.talkLeft ?? -1}
      lang={room.lang || loc.lang}
      dubFilm={dubFilm}
      dubLanguages={dubLangs}
      prefAudio={pref.split("-")[0]}
      prefSubs={loc.lang.split("-")[0]}
      vrSeat={tickets.some((t) => t.showtimeId === showtime && t.status === "paid" && t.quality === "vr")}
      myReview={rev?.status === 200 ? ((rev.body as { review?: { stars: number; tags: string[]; body: string } | null }).review ?? null) : null}
    />
  );
}
