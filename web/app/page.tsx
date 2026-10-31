import Link from "next/link";
import Countdown from "@/components/Countdown";
import SiteFooter from "@/components/SiteFooter";
import SiteNav from "@/components/SiteNav";
import { currentAccount } from "@/lib/auth";
import { showtimes } from "@/lib/catalog";

export const dynamic = "force-dynamic";

type Live = { id: string; capacity: number; available: number };

// Seat counts come from the ticket ledger; the page still renders if the API is slow.
async function liveSeats(): Promise<Record<string, Live>> {
  if (!process.env.API_URL) return {};
  try {
    const res = await fetch(`${process.env.API_URL}/v1/showtimes`, { signal: AbortSignal.timeout(3000), cache: "no-store" });
    const list = (await res.json()) as Live[];
    return Object.fromEntries(list.map((s) => [s.id, s]));
  } catch {
    return {};
  }
}

// Screenings that haven't started yet; falls back to the full list so the page is never empty.
function lineupNow() {
  const now = Date.now();
  const upcoming = showtimes.filter((s) => Date.parse(s.startsAt) > now);
  return upcoming.length ? upcoming : showtimes;
}

const when = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "UTC" }) + " GMT";

export default async function Home() {
  const [me, seats] = await Promise.all([currentAccount(), liveSeats()]);
  const lineup = lineupNow();
  const next = lineup[0];
  const nextSeats = seats[next.id];

  return (
    <div className="home">
      <header className="hero">
        <div className="glow" aria-hidden />
        <SiteNav signedIn={Boolean(me)} />
        <div className="hero-copy">
          <div className="badges">
            <span className="badge live"><i />WORLD PREMIERE</span>
            <span className="badge outline">SCREENING ONCE · {when(next.startsAt).toUpperCase()}</span>
          </div>
          <h1>{next.film}</h1>
          <p className="meta">{next.studio}</p>
          <p className="lede">
            One night, one screening, the whole world in the same seat. Hear it in your language with AI dubbing, and
            talk to the people watching with you in Lagos, Seoul or Lyon.
          </p>
          <Countdown to={next.startsAt} />
          <div className="ctas">
            <Link href="/checkout" className="cta big">Get a seat · {next.price.currency} {next.price.value}</Link>
            <Link href="/watch/red-earth-sample" className="nav-btn big">Hear the AI dub</Link>
          </div>
          {nextSeats && (
            <div className="seats">
              <span className="bar"><span style={{ width: `${Math.round((1 - nextSeats.available / Math.max(1, nextSeats.capacity)) * 100)}%` }} /></span>
              {nextSeats.available.toLocaleString()} of {nextSeats.capacity.toLocaleString()} seats left
            </div>
          )}
        </div>
      </header>

      <section className="band">
        <p className="eyebrow">Premieres</p>
        <h2>Each film screens once. Miss it and it&apos;s gone.</h2>
        <ul className="premieres">
          {lineup.map((s) => (
            <li key={s.id}>
              <div className="poster" aria-hidden><span>{s.film}</span></div>
              <strong>{s.film}</strong>
              <span className="muted">{s.studio}</span>
              <span className="muted">{when(s.startsAt)}</span>
              <Link href="/checkout" className="price-link">{s.price.currency} {s.price.value}</Link>
            </li>
          ))}
        </ul>
      </section>

      <section className="band how">
        <p className="eyebrow">How it works</p>
        <h2>A cinema seat without the cinema</h2>
        <ol className="steps3">
          <li><b>01</b><strong>Pick a premiere</strong><span>Only new releases, and each screening disappears once it ends.</span></li>
          <li><b>02</b><strong>Take your seat</strong><span>Pay once with PayPal or card. One verified account per person keeps tickets fair.</span></li>
          <li><b>03</b><strong>Watch with the world</strong><span>Same frame, same second, for everyone. Pick your audio language and talk in the room.</span></li>
        </ol>
      </section>

      <section className="band lang">
        <p className="eyebrow">Your language, live</p>
        <h2>Hear every film in your mother tongue</h2>
        <p className="lede">
          AI dubbing and subtitles run alongside the stream, so a premiere from Lagos plays in French in Lyon and in
          Korean in Seoul. Try the Yorùbá, French and Korean dubs of the Red Earth trailer now.
        </p>
        <Link href="/watch/red-earth-sample" className="cta">Listen to the dubs</Link>
      </section>

      <section className="band">
        <p className="eyebrow">Safe by design</p>
        <h2>One person, one seat</h2>
        <ul className="features">
          <li><strong>Verified accounts</strong><span>Face and ID checks stop bots and resellers buying up premieres.</span></li>
          <li><strong>Two devices at most</strong><span>Sign in on a new device and the oldest one signs out.</span></li>
          <li><strong>Passkeys</strong><span>Sign in with your fingerprint or face, no password to steal.</span></li>
          <li><strong>AI concierge</strong><span>Ask what is on, in your language, and book in a sentence.</span></li>
        </ul>
      </section>

      <div className="band"><SiteFooter /></div>
    </div>
  );
}
