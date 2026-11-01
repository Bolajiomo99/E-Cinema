import Link from "next/link";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import LibraryPlayer from "@/components/library/LibraryPlayer";
import CopyLink from "@/components/library/CopyLink";
import LocalWhen from "@/components/dash/LocalWhen";
import { accountApi, currentAccount, SESSION_COOKIE } from "@/lib/auth";
import { findShowtime } from "@/lib/catalog";
import { readLocale } from "@/lib/locale";
import { dubLanguages, filmStream, mediaEnabled } from "@/lib/media";

// A rewatch party: one film, one shared clock, for friends who all have it in their library.
export const dynamic = "force-dynamic";
export const metadata = { title: "Rewatch party · E-Cinema", robots: { index: false } };

type Party = { code: string; showtimeId: string; film: string; host: string; mine: boolean; startsAt: string };

export default async function RewatchParty({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  if (!/^[a-z0-9]{10}$/.test(code)) notFound();
  const me = await currentAccount();
  if (!me) redirect(`/signin?next=/rewatch/${code}`);
  const session = (await cookies()).get(SESSION_COOKIE)?.value ?? "";
  const r = await accountApi("GET", `/v1/me/rewatch/${code}`, undefined, session);
  if (r.status !== 200) {
    return (
      <section className="room-gate">
        <Link href="/library" className="wordmark">E-CINEMA</Link>
        <h1>Rewatch party</h1>
        <p className="muted">{r.status === 403 ? "The replay window for this film has closed on your account. Keep the film to join." : "This party is for friends who have the film in their library: a seat at its premiere within 30 days, or a kept copy."}</p>
        <Link href="/library" className="cta big">Go to your library</Link>
      </section>
    );
  }
  const p = r.body as Party;
  const s = findShowtime(p.showtimeId);
  const start = Date.parse(p.startsAt);
  const runtime = (s?.runtimeMin ?? 120) * 60_000;
  if (Date.now() > start + runtime) {
    return (
      <section className="room-gate">
        <Link href="/library" className="wordmark">E-CINEMA</Link>
        <h1>{p.film}</h1>
        <p className="muted">This rewatch party has ended.</p>
        <Link href={`/library/rewatch/${p.showtimeId}`} className="cta big">Start another</Link>
      </section>
    );
  }
  const stream = mediaEnabled ? await filmStream(new Date(start + runtime)).catch(() => null) : null;
  let dubFilm = p.showtimeId;
  let langs: string[] = [];
  if (mediaEnabled) {
    langs = await dubLanguages(dubFilm).catch(() => []);
    if (!langs.length && stream) {
      dubFilm = "stand-in";
      langs = await dubLanguages(dubFilm).catch(() => []);
    }
  }
  const [prof, loc] = await Promise.all([accountApi("GET", "/v1/me/profile", undefined, session).catch(() => null), readLocale()]);
  const pa = prof?.status === 200 ? ((prof.body as { audioLanguage?: string }).audioLanguage ?? "") : "";
  return (
    <>
      <div className="rw-bar">
        <span>{p.mine ? "Your rewatch party" : `${p.host}'s rewatch party`} · starts <LocalWhen iso={p.startsAt} /></span>
        <CopyLink text={`Rewatch ${p.film} with me on E-Cinema:`} />
      </div>
      <LibraryPlayer
        film={p.film} stream={stream} viewerCode={me.id.slice(0, 8).toUpperCase()} original={s?.language ?? "English"}
        dubFilm={dubFilm} dubLanguages={langs} prefAudio={pa} prefSubs={loc.lang.split("-")[0]} syncStart={start} showtimeId={p.showtimeId}
      />
    </>
  );
}
