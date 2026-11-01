import Link from "next/link";
import TopNav from "@/components/dash/TopNav";
import { DashShell } from "@/components/dash/DashShell";
import Countdown from "@/components/Countdown";
import TrailerButton from "@/components/landing/TrailerButton";
import { seatsFor } from "@/lib/api";
import { currentAccount } from "@/lib/auth";
import { showtimes, type Showtime } from "@/lib/catalog";
import { typeOf } from "@/lib/browse";
import { readLocale } from "@/lib/locale";
import { nextPriceRise, preorderSave } from "@/lib/ticket-quote";

// Built from the Figma frame "Web / Coming soon" (52:808): titles months out, bookable now at a
// pre-order price that rises in 3 stages as release gets closer.
export const dynamic = "force-dynamic";
export const metadata = { title: "Coming soon · E-Cinema" };

const DAY = 86_400_000;
const FILTERS = [
  { id: "all", label: "All" },
  { id: "month", label: "This month" },
  { id: "3m", label: "In 3 months" },
  { id: "year", label: "Next year" },
  { id: "anime", label: "Anime" },
  { id: "k-drama", label: "K-drama" },
  { id: "cartoons", label: "Cartoons" },
  { id: "vr", label: "VR ready" },
] as const;
type F = (typeof FILTERS)[number]["id"];

const money = (cur: string, cents: number) => (cur === "USD" ? `$${(cents / 100).toFixed(2)}` : `${cur} ${(cents / 100).toFixed(2)}`);
const cents = (s: Showtime) => Math.round(Number(s.price.value) * 100);
const preorderCents = (s: Showtime, now: number) => Math.round(cents(s) * (1 - preorderSave(s, now) / 100));

// "IN 3 WEEKS", "IN 2 MONTHS", "IN 1 YEAR" as on the Figma badges.
function inLabel(ms: number) {
  const d = ms / DAY;
  if (d < 1) return "TODAY";
  if (d < 7) return `IN ${Math.round(d)} DAY${Math.round(d) === 1 ? "" : "S"}`;
  if (d < 30) return `IN ${Math.round(d / 7)} WEEK${Math.round(d / 7) === 1 ? "" : "S"}`;
  if (d < 330) return `IN ${Math.round(d / 30.4)} MONTH${Math.round(d / 30.4) === 1 ? "" : "S"}`;
  return `IN ${Math.max(1, Math.round(d / 365))} YEAR${Math.round(d / 365) > 1 ? "S" : ""}`;
}
const words = (s: Showtime) => {
  const w = s.film.toUpperCase().split(" ");
  return w.length > 2 ? [w.slice(0, Math.ceil(w.length / 2)).join(" "), w.slice(Math.ceil(w.length / 2)).join(" ")] : w.length === 2 ? w : [s.film.toUpperCase()];
};
const kind = (s: Showtime) => (s.category === "K-Drama" ? "K-drama" : s.category === "Cartoon" ? "Cartoon" : s.category === "Anime" ? "Anime" : (s.genres ?? [])[0] ?? "Film");
const runtime = (m?: number) => (m ? `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m` : "");

function matches(s: Showtime, f: F, now: number) {
  const t = Date.parse(s.startsAt);
  const nowD = new Date(now);
  switch (f) {
    case "month": return new Date(t).getUTCFullYear() === nowD.getUTCFullYear() && new Date(t).getUTCMonth() === nowD.getUTCMonth();
    case "3m": return t - now <= 92 * DAY;
    case "year": return new Date(t).getUTCFullYear() > nowD.getUTCFullYear();
    case "anime": case "k-drama": case "cartoons": return typeOf(s) === f;
    case "vr": return Boolean(s.vr);
    default: return true;
  }
}

function Poster({ s, h }: { s: Showtime; h: number }) {
  const p = s.poster ?? { from: "#1b1b21", via: "#0e0e12", to: "#000", glow: "rgba(227,24,45,.45)" };
  return (
    <span className="cs-poster" style={{ height: h, background: `linear-gradient(180deg, ${p.from} 0%, ${p.via} 60%, ${p.to} 100%)` }}>
      <span className="lp-poster-glow" style={{ background: p.glow }} aria-hidden />
      <span className="lp-poster-shade" aria-hidden />
      <span className="lp-poster-title">{words(s).map((l) => <span key={l}>{l}</span>)}</span>
    </span>
  );
}

const VrIcon = () => (
  <svg viewBox="0 0 14 14" aria-hidden><path d="M1.5 4.5h11v5h-3.2L7 7.6 4.7 9.5H1.5z" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" /><circle cx="4.3" cy="7" r=".9" fill="currentColor" /><circle cx="9.7" cy="7" r=".9" fill="currentColor" /></svg>
);

export default async function ComingSoonPage({ searchParams }: { searchParams: Promise<{ f?: string }> }) {
  const [q, me, loc] = await Promise.all([searchParams, currentAccount(), readLocale()]);
  const now = Date.now();
  const f = (FILTERS.find((x) => x.id === q.f)?.id ?? "all") as F;
  // Coming soon = anything more than a week out, soonest first.
  const soon = showtimes.filter((s) => Date.parse(s.startsAt) - now > 7 * DAY).sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
  const hero = soon.find((s) => s.blurb && s.earlySave) ?? soon[0];
  const grid = soon.filter((s) => s !== hero && matches(s, f, now));
  const seats = hero ? await seatsFor(hero.id) : null;
  const booked = seats ? seats.capacity - seats.available : 0;
  const rise = hero ? nextPriceRise(hero, now) : null;

  const body = (
    <div className="lp cs">
      <TopNav me={me} active="coming" t={loc.t} country={loc.country} lang={loc.lang} />
      {hero && (
        <header className="cs-hero">
          <span className="cs-glow" aria-hidden />
          <div className="cs-copy">
            <div className="cs-badges">
              <span className="lp-badge cs-white">COMING SOON</span>
              <span className="lp-badge outline">{inLabel(Date.parse(hero.startsAt) - now)} · {new Date(hero.startsAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }).toUpperCase()}</span>
            </div>
            <h1>{hero.film.toUpperCase()}</h1>
            <p className="cs-meta">{[kind(hero), hero.studio, runtime(hero.runtimeMin), hero.format, hero.vr && "VR ready"].filter(Boolean).join(" · ")}</p>
            <div className="cs-cd"><Countdown to={hero.startsAt} /></div>
            <div className="cs-price">
              <b>{money(hero.price.currency, preorderCents(hero, now))}</b>
              {preorderSave(hero, now) > 0 && <>
                <span>{money(hero.price.currency, cents(hero))} on release day</span>
                <span className="lp-badge outline">SAVE {preorderSave(hero, now)}%</span>
              </>}
            </div>
            <div className="lp-ctas">
              <Link href={`/checkout?film=${hero.id}`} className="lp-btn">Pre-order seat</Link>
              <TrailerButton film={hero.id} title={hero.film} className="lp-btn secondary" />
              <a href={`/api/calendar/${hero.id}.ics`} className="lp-btn ghost">Remind me</a>
            </div>
            <p className="cs-note">
              {booked > 0 ? `${booked.toLocaleString("en")} seat${booked === 1 ? "" : "s"} pre-ordered · ` : "Be the first to pre-order · "}
              price rises in 3 stages as release gets closer
              {rise ? `, next on ${new Date(rise).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" })}` : ""}
            </p>
          </div>
          <Link href={`/film/${hero.id}`} className="cs-hero-poster" aria-label={`${hero.film} details`}><Poster s={hero} h={420} /></Link>
        </header>
      )}

      <main className="cs-body">
        <div className="cs-head">
          <h2>Coming soon</h2>
          <nav className="br-chips" aria-label="Filter">
            {FILTERS.map((x) => (
              <Link key={x.id} href={x.id === "all" ? "/coming-soon" : `/coming-soon?f=${x.id}`} className={`br-chip${f === x.id ? " on" : ""}`} aria-current={f === x.id ? "page" : undefined}>{x.label}</Link>
            ))}
            <Link href="/releases" className="br-chip cs-cal">Calendar</Link>
          </nav>
        </div>
        {grid.length === 0 ? (
          <div className="br-empty">
            <strong>Nothing scheduled here yet</strong>
            <p>Studios add titles every week. Try another filter.</p>
            <Link href="/coming-soon" className="lp-btn sm secondary">Show all</Link>
          </div>
        ) : (
          <div className="cs-grid">
            {grid.map((s) => {
              const save = preorderSave(s, now);
              return (
                <article key={s.id} className="cs-card">
                  <Link href={`/film/${s.id}`} className="cs-p">
                    <Poster s={s} h={300} />
                    <span className="lp-badge outline cs-when">{inLabel(Date.parse(s.startsAt) - now)}</span>
                    {s.vr && <span className="cs-vr"><VrIcon />VR</span>}
                  </Link>
                  <p className="cs-sub">{[kind(s), s.episodes && `${s.episodes} episodes`, s.studio].filter(Boolean).join(" · ")}</p>
                  <div className="cs-pr">
                    <div>
                      <strong>{save ? "Pre-order" : "Seat"} {money(s.price.currency, preorderCents(s, now))}</strong>
                      {save > 0 && <small>Save {save}%</small>}
                    </div>
                    <Link href={`/checkout?film=${s.id}`} className="lp-btn sm secondary">{save ? "Pre-order" : "Get a seat"}</Link>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
  return me ? <DashShell>{body}</DashShell> : body;
}
