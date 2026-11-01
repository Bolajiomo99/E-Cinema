import Link from "next/link";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import LibraryPlayer from "@/components/library/LibraryPlayer";
import KeepButton from "@/components/library/KeepButton";
import { accountApi, currentAccount, SESSION_COOKIE } from "@/lib/auth";
import { findShowtime } from "@/lib/catalog";
import { keepPrice } from "@/lib/library";
import { readLocale } from "@/lib/locale";
import { dubLanguages, filmStream, mediaEnabled } from "@/lib/media";

// Play a film from the Library: within the 30-day replay window after its premiere, or for
// good once kept. Same protections as the room: watermark, no download, no picture-in-picture.
export const dynamic = "force-dynamic";
export const metadata = { title: "Watch · E-Cinema", robots: { index: false } };

export default async function PlayPage({ params }: { params: Promise<{ showtime: string }> }) {
  const { showtime } = await params;
  const s = findShowtime(showtime);
  if (!s) notFound();
  const me = await currentAccount();
  if (!me) redirect(`/signin?next=/library/play/${showtime}`);
  const session = (await cookies()).get(SESSION_COOKIE)?.value ?? "";
  const access = await accountApi("GET", `/v1/me/library/${encodeURIComponent(s.id)}`, undefined, session);
  if (access.status !== 200) {
    const gone = access.status === 403;
    return (
      <section className="room-gate">
        <Link href="/library" className="wordmark">E-CINEMA</Link>
        <h1>{s.film}</h1>
        <p className="muted">{gone ? "The 30-day replay window for this premiere has closed. Keep the film to watch it again whenever you like." : "This film is not in your library. Films you watch at a premiere stay here for 30 days."}</p>
        {gone ? <KeepButton showtimeId={s.id} hd={keepPrice(s.price.value, "hd")} uhd={keepPrice(s.price.value, "4k")} currency={s.price.currency} /> : <Link href="/library" className="cta big">Back to your library</Link>}
      </section>
    );
  }
  const stream = mediaEnabled ? await filmStream(new Date(Date.now() + (s.runtimeMin ?? 120) * 60_000)).catch(() => null) : null;
  let dubFilm = s.id;
  let langs: string[] = [];
  if (mediaEnabled) {
    langs = await dubLanguages(s.id).catch(() => []);
    if (!langs.length && stream) {
      dubFilm = "stand-in";
      langs = await dubLanguages(dubFilm).catch(() => []);
    }
  }
  const [prof, loc] = await Promise.all([accountApi("GET", "/v1/me/profile", undefined, session).catch(() => null), readLocale()]);
  const p = prof?.status === 200 ? (prof.body as { audioLanguage?: string }) : {};
  return (
    <LibraryPlayer
      film={s.film} stream={stream} viewerCode={me.id.slice(0, 8).toUpperCase()} original={s.language ?? "English"}
      dubFilm={dubFilm} dubLanguages={langs} prefAudio={p.audioLanguage ?? ""} prefSubs={loc.lang.split("-")[0]}
      back={`/library?film=${s.id}`}
    />
  );
}
