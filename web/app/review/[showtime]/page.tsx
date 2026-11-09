import { cookies } from "next/headers";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import TopNav from "@/components/dash/TopNav";
import { DashShell } from "@/components/dash/DashShell";
import ReviewCard from "@/components/review/ReviewCard";
import { accountApi, currentAccount, SESSION_COOKIE } from "@/lib/auth";
import { findShowtime, showtimes } from "@/lib/catalog";
import { readLocale } from "@/lib/locale";
import { quote } from "@/lib/ticket-quote";

// Rate and review, from the Figma frame "Web / Rate & review" (96:1302).
export const dynamic = "force-dynamic";
export const metadata = { title: "How was it? · E-Cinema", robots: { index: false } };

const money = (cur: string, v: string) => (cur === "USD" ? `$${v}` : `${cur} ${v}`);

export default async function ReviewPage({ params }: { params: Promise<{ showtime: string }> }) {
  const { showtime } = await params;
  const s = findShowtime(showtime);
  if (!s) notFound();
  const session = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!session) redirect(`/signin?next=/review/${s.id}`);
  const [me, loc, mine] = await Promise.all([currentAccount(), readLocale(), accountApi("GET", `/v1/me/reviews/${s.id}`, undefined, session).catch(() => null)]);
  if (!me) redirect(`/signin?next=/review/${s.id}`);
  const started = Date.parse(s.startsAt) <= Date.now();
  const ended = Date.parse(s.startsAt) + (s.runtimeMin ?? 120) * 60_000 <= Date.now();

  // The studio's next premiere, to keep the night going.
  const now = Date.now();
  const nextFilm = showtimes.filter((x) => x.studio === s.studio && x.id !== s.id && Date.parse(x.startsAt) > now && !x.adult).sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt))[0];
  const nq = nextFilm ? quote(nextFilm, undefined, now) : null;
  const next = nextFilm && nq ? { text: `Next from ${s.studio}: ${nextFilm.film} · ${nq.preorderSave > 0 ? "pre-order" : "seats"} from ${money(nq.currency, nq.seat)}`, href: `/preorder/${nextFilm.id}`, cta: nq.preorderSave > 0 ? "Pre-order" : "Get a seat" } : null;

  const body = (
    <div className="lp rv-page">
      <TopNav me={me} active="live" t={loc.t} country={loc.country} lang={loc.lang} />
      <main id="main" className="rv-wrap">
        {started ? (
          <ReviewCard showtimeId={s.id} eyebrow={`${s.film.toUpperCase()} · ${ended ? "THE END" : "NOW SHOWING"}`}
            initial={(mine?.status === 200 ? (mine.body as { review?: { stars: number; tags: string[]; body: string } | null }).review : null) ?? null} next={next} />
        ) : (
          <div className="rv">
            <p className="rv-eyebrow">{s.film.toUpperCase()}</p>
            <h1>Reviews open at the premiere</h1>
            <p className="rv-soon">Come back once the film has started. <Link href={`/film/${s.id}`}>See the film page</Link>.</p>
          </div>
        )}
      </main>
    </div>
  );
  return <DashShell>{body}</DashShell>;
}
