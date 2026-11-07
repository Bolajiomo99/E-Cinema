import Link from "next/link";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import TopNav from "@/components/dash/TopNav";
import { DashShell } from "@/components/dash/DashShell";
import LocalWhen from "@/components/dash/LocalWhen";
import TrailerButton from "@/components/landing/TrailerButton";
import AudioChips from "@/components/film/AudioChips";
import PosterCard from "@/components/browse/PosterCard";
import { liveStats, myTickets, seatsFor } from "@/lib/api";
import { accountApi, currentAccount, SESSION_COOKIE } from "@/lib/auth";
import { findShowtime, showtimes } from "@/lib/catalog";
import { filterShowtimes, typeOf } from "@/lib/browse";
import { LANGS } from "@/lib/i18n";
import { readLocale } from "@/lib/locale";
import type { Party } from "@/lib/parties";
import { doorsCloseAt, LATE_GRACE_MIN, phaseOf, quote, salesOver } from "@/lib/ticket-quote";
import LateEntry, { MinutesIn } from "@/components/film/LateEntry";
import LiveAudience from "@/components/dash/LiveAudience";
import ViewBeacon from "@/components/film/ViewBeacon";
import { endsAt } from "@/lib/catalog";

// Built from the Figma frame "Web / Film detail · premiere page" (30:904).
export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const s = findShowtime((await params).id);
  return { title: s ? `${s.film} · E-Cinema` : "Film · E-Cinema", description: s?.blurb };
}

const CODE: Record<string, string> = { English: "en", Yoruba: "yo", Hausa: "ha", Igbo: "ig", French: "fr", Hindi: "hi", Korean: "ko", Spanish: "es", Portuguese: "pt", German: "de", Arabic: "ar", Swahili: "sw" };
const CITIES: [string, string][] = [["Lagos", "Africa/Lagos"], ["London", "Europe/London"], ["Nairobi", "Africa/Nairobi"], ["Mumbai", "Asia/Kolkata"], ["New York", "America/New_York"], ["Seoul", "Asia/Seoul"]];
const NOTES: Record<string, string> = {
  G: "Suitable for all ages.",
  PG: "Some scenes may need a parent nearby. Suitable for most ages.",
  "PG-13": "Peril and mild language. Suitable for 13+.",
  "18+": "Adult themes. Only viewers who have finished the face and ID check can book.",
};
const money = (cur: string, v: string) => (cur === "USD" ? `$${v}` : `${cur} ${v}`);
const runtime = (m?: number) => (m ? `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m` : "");

export default async function FilmPage({ params }: { params: Promise<{ id: string }> }) {
  const s = findShowtime((await params).id);
  if (!s) notFound();
  const [me, loc, seats, live] = await Promise.all([currentAccount(), readLocale(), seatsFor(s.id), liveStats()]);
  const session = (await cookies()).get(SESSION_COOKIE)?.value;
  let profile: { plan?: string; planStatus?: string; country?: string; audioLanguage?: string } | undefined;
  let parties: Party[] = [];
  let mine: Awaited<ReturnType<typeof myTickets>> = [];
  if (me && session) {
    const [p, pr, t] = await Promise.all([
      accountApi("GET", "/v1/me/profile", undefined, session).catch(() => null),
      accountApi("GET", "/v1/me/parties", undefined, session).catch(() => null),
      myTickets(session).catch(() => []),
    ]);
    if (p?.status === 200) profile = p.body as typeof profile;
    if (pr?.status === 200) parties = ((pr.body as Party[]) ?? []).filter((x) => x.showtimeId === s.id);
    mine = t;
  }
  // The studio keeps this film out of some countries (studio settings "Default territories").
  const regionBlocked = Boolean(loc.country && s.blocked?.includes(loc.country));
  const owned = mine.some((t) => t.showtimeId === s.id && t.status === "paid");
  const q = quote(s, profile ? { ...profile, country: profile.country || loc.country } : { country: loc.country });
  const phase = phaseOf(s);
  const p = s.poster ?? { from: "#1b1b21", via: "#0e0e12", to: "#000", glow: "rgba(227,24,45,.45)" };
  const original = CODE[s.language ?? "English"] ?? "en";
  const audio = profile?.audioLanguage || loc.lang;
  const options: [string, string][] = [...LANGS.filter(([c]) => c === original), ...LANGS.filter(([c]) => c !== original)];
  const left = seats ? seats.available : null;
  const pct = seats && seats.capacity ? (seats.capacity - seats.available) / seats.capacity : 0;

  // "Why you will like it": worked out from the viewer's own tickets, never invented.
  const owns = showtimes.filter((x) => x.id !== s.id && mine.some((t) => t.showtimeId === x.id && t.status === "paid"));
  const shared = owns.filter((x) => x.genres?.some((g) => s.genres?.includes(g)) || typeOf(x) === typeOf(s));
  const why = !me
    ? "Sign in and we will tell you how this premiere matches the films you book."
    : shared.length
      ? `You have seats for ${shared.length} similar premiere${shared.length === 1 ? "" : "s"} (${shared.slice(0, 2).map((x) => x.film).join(", ")}). ${s.film} shares the ${(s.genres ?? []).join(" and ").toLowerCase() || "same"} feel.`
      : `A ${(s.genres ?? ["new"]).join(", ").toLowerCase()} premiere from ${s.studio}. Book a few films and this card learns what you like.`;
  const more = filterShowtimes({}).filter((x) => x.id !== s.id && typeOf(x) === typeOf(s)).slice(0, 6);
  const back = `/film/${s.id}`;
  // "Pre-order the next screening": each film screens once, so this is the next premiere of the same kind.
  const next = showtimes.find((x) => x.id !== s.id && Date.parse(x.startsAt) > Date.now() && typeOf(x) === typeOf(s)) ?? showtimes.find((x) => Date.parse(x.startsAt) > Date.now());

  const body = (
    <div className="lp fd">
      <header className="fd-hero" style={{ background: `linear-gradient(90deg, ${p.from} 0%, ${p.via} 60%, #000 100%)` }}>
        <span className="fd-glow a" style={{ background: p.glow }} aria-hidden />
        <span className="fd-glow b" style={{ background: p.glow }} aria-hidden />
        <span className="fd-fade-left" aria-hidden />
        <span className="fd-fade-bottom" aria-hidden />
        <TopNav me={me} t={loc.t} country={loc.country} lang={loc.lang} />
        <ViewBeacon film={s.id} />
        <div className="fd-copy">
          <div className="lp-badges">
            {phase === "grace" || phase === "late" || phase === "closed" ? (
              <>
                <span className="lp-badge live pulse"><i />LIVE NOW<MinutesIn start={Date.parse(s.startsAt)} /></span>
                <LiveAudience showtimeId={s.id} initial={live.find((x) => x.showtimeId === s.id)} />
              </>
            ) : phase === "ended" ? (
              <span className="lp-badge outline">ENDED</span>
            ) : (
              <span className="br-badge soon fd-when"><LocalWhen iso={s.startsAt} /></span>
            )}
            <span className="br-badge">SCREENS ONCE</span>
            {s.adult && <span className="br-badge fd-adult">18+</span>}
          </div>
          <h1 className="fd-title">{s.film.toUpperCase()}</h1>
          <div className="fd-meta">
            {[s.year, (s.genres ?? []).join(", "), runtime(s.runtimeMin)].filter(Boolean).map((m, i) => <span key={i}>{m}</span>)}
            {s.rating && <span className="br-badge">{s.rating}</span>}
            <span className="br-badge">{s.dubs ?? 3} AI DUBS</span>
          </div>
          <p className="lp-body-l fd-blurb">{s.blurb ?? `${s.film} premieres once, worldwide at the same moment, with live AI dubs and a shared chat.`} From {s.studio}.</p>
          <div className="lp-ctas">
            {phase === "ended" ? (
              <Link href="/browse" className="lp-btn lg">Find another premiere</Link>
            ) : !owned && regionBlocked ? (
              <Link href="/browse" className="lp-btn lg">Find another premiere</Link>
            ) : !owned && !s.adult && (phase === "grace" || phase === "late" || phase === "closed") ? null : owned ? (
              <Link href={`/room/${s.id}`} className="lp-btn lg">{phase === "before" ? "Open my room" : "Join the room"}</Link>
            ) : s.adult ? (
              <Link href={`/unlock/${s.id}`} className="lp-btn lg">Unlock in 4 stages · {money(q.currency, q.total)} each</Link>
            ) : (
              <Link href={`/checkout?film=${s.id}`} className="lp-btn lg">{phase === "late" ? "Late entry" : "Get a seat"} · {money(q.currency, q.total)}</Link>
            )}
            <TrailerButton film={s.id} title={s.film} className="lp-btn lg secondary" />
            {phase === "before" && <a href={`/api/calendar/${s.id}.ics`} className="lp-btn lg ghost">Remind me</a>}
          </div>
          {!owned && regionBlocked && phase !== "ended" && <p className="fd-late" role="note">{s.studio} does not offer this film in your country, so seats cannot be booked from here.</p>}
          {!salesOver(phase) && left !== null && seats && (
            <div className="fd-seats">
              <span className="fd-bar" aria-hidden><i style={{ width: `${Math.round(pct * 100)}%` }} /></span>
              <span className={pct >= 0.75 ? "warn" : undefined}>{left === 0 ? "Sold out" : `${pct >= 0.75 ? "Selling fast · " : ""}${left.toLocaleString("en")} of ${seats.capacity.toLocaleString("en")} seats left`}</span>
            </div>
          )}
          {(phase === "grace" || phase === "late" || phase === "closed") && !owned && !s.adult && !regionBlocked && (
            <LateEntry start={Date.parse(s.startsAt)} doubles={Date.parse(s.startsAt) + LATE_GRACE_MIN * 60_000} closes={doorsCloseAt(s)} end={endsAt(s)}
              join={money(q.currency, q.total)} joinHref={`/checkout?film=${s.id}`} nextHref={next ? `/film/${next.id}` : undefined} />
          )}
          {phase === "late" && !owned && s.adult && <p className="fd-late">Late entry: after the first {LATE_GRACE_MIN} minutes a seat costs double.</p>}
        </div>
      </header>

      <main className="fd-body">
        <div className="fd-left">
          <section>
            <h2 className="fd-h2">Watch it in</h2>
            <AudioChips options={options} original={original} initial={audio} auto={!profile?.audioLanguage} signedIn={Boolean(me)} next={back} />
          </section>
          <section>
            <h2 className="fd-h2">Cast and crew</h2>
            <div className="fd-cast">
              <div className="fd-person"><span style={{ background: "#e3182d" }}>{s.studio.charAt(0)}</span><b>{s.studio}</b><small>Studio</small></div>
              <p className="fd-note">The studio publishes the full cast and crew before the premiere.</p>
            </div>
          </section>
          <section>
            <h2 className="fd-h2">One screening, your local time</h2>
            <div className="fd-times">
              <div className="fd-time you"><small>You</small><b><LocalWhen iso={s.startsAt} /></b></div>
              {CITIES.map(([city, tz]) => (
                <div key={city} className="fd-time"><small>{city}</small><b>{new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit" }).format(new Date(s.startsAt))}</b></div>
              ))}
            </div>
          </section>
        </div>
        <aside className="fd-right">
          <div className="fd-card">
            <h3>Watch parties</h3>
            {parties.length ? (
              <ul className="fd-parties">
                {parties.map((x) => <li key={x.code}><Link href={`/p/${x.code}`}>{x.name}</Link></li>)}
              </ul>
            ) : (
              <p>Watch with friends in a private room with its own chat. Friend lists are coming soon; invite anyone by email now.</p>
            )}
            {!salesOver(phase) && <Link href={me ? `/parties/new?film=${s.id}` : `/join?next=${encodeURIComponent(`/parties/new?film=${s.id}`)}`} className="lp-btn secondary fd-full">Start a watch party</Link>}
          </div>
          <div className="fd-card fd-ai">
            <h3><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#f5a524" strokeWidth="2" strokeLinecap="round" aria-hidden><path d="M12 2v4M12 18v4M4.9 4.9l2.8 2.8M16.3 16.3l2.8 2.8M2 12h4M18 12h4M4.9 19.1l2.8-2.8M16.3 7.7l2.8-2.8" /></svg>Why you will like it</h3>
            <p>{why}</p>
          </div>
          <div className="fd-card">
            <h3>Content notes</h3>
            <p>{NOTES[s.rating ?? ""] ?? "Rating to be confirmed by the studio."} Rated {s.rating ?? "TBC"} by the studio.</p>
          </div>
        </aside>
      </main>

      {more.length > 0 && (
        <section className="hm-row br-row fd-more" aria-label="More like this">
          <div className="hm-row-head"><div><h2>More like this</h2><p>Other {typeOf(s).replace("-", " ")} premieres</p></div><Link href={`/browse?type=${typeOf(s)}&when=all`}>See all</Link></div>
          <div className="br-grid">{more.map((x) => <PosterCard key={x.id} s={x} />)}</div>
        </section>
      )}
    </div>
  );
  return me ? <DashShell>{body}</DashShell> : body;
}
