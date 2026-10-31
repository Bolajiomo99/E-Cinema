import Link from "next/link";
import { headers } from "next/headers";
import AskAIButton from "@/components/ai/AskAIButton";
import Countdown from "@/components/Countdown";
import HeroWhen from "@/components/landing/HeroWhen";
import LanguageDemo from "@/components/landing/LanguageDemo";
import Logo from "@/components/landing/Logo";
import AccountMenu from "@/components/AccountMenu";
import PremiereStrip from "@/components/landing/PremiereStrip";
import { currentAccount } from "@/lib/auth";
import { endsAt, showtimes } from "@/lib/catalog";

// Built from the Figma frame "Web / Landing" (14:280). Films, times, prices and seats are live data.
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

// Screenings that haven't ended yet; falls back to the full list so the page is never empty.
function lineupNow() {
  const now = Date.now();
  const open = showtimes.filter((s) => endsAt(s) > now);
  const list = open.length ? open : showtimes;
  const hero = list.find((s) => s.featured && Date.parse(s.startsAt) > now) ?? list.find((s) => Date.parse(s.startsAt) > now) ?? list[0];
  return { list, hero };
}

const money = (p: { currency: string; value: string }) => (p.currency === "USD" ? `$${p.value}` : `${p.currency} ${p.value}`);
const runtime = (m?: number) => (m ? `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m` : "");

const STEPS = [
  ["01", "Pick tonight's premiere", "Only new releases, and each screening disappears once it ends. Miss it and it is gone."],
  ["02", "Take your seat", "Pay once with card, Paystack, Flutterwave or crypto. Prices are set for your country."],
  ["03", "Watch with the world", "Same frame, same second, for everyone. Pick your audio language and talk in the room chat."],
];

// soon = designed and planned, not switched on yet; the page says so rather than pretending.
const FEATURES = [
  ["i-chat", "Room chat across borders", "Text, voice notes, photos, documents and reactions, translated for every reader.", false],
  ["i-volume", "Volume past 100%", "Boost dialogue up to 200% for noisy rooms and small phone speakers.", true],
  ["i-snack", "AI snack critic", "Snap your food, get a rating and a pairing tip, and find films that match tonight's mood.", true],
  ["i-lock", "Locked-down screen", "One person, one account. Screenshots, screen recording and downloads are blocked.", false],
  ["i-private", "Private screenings", "Enterprise members can watch alone or invite their own guest list.", true],
  ["i-data", "Data saver", "Watch in 240p audio-first mode on as little as 150 MB per film.", false],
] as const;

const PLANS = [
  { badge: "FREE", kind: "outline", price: "₦0", per: "", ticks: [["✓", "Buy single tickets"], ["✓", "Read chat and react"], ["—", "Muted in chat"]] },
  { badge: "STUDENT", kind: "student", price: "₦1,500", per: "/mo", ticks: [["✓", "Most Pro features"], ["✓", "Verified school email"], ["✓", "2 premieres a month"]] },
  { badge: "PRO", kind: "pro", price: "₦4,500", per: "/mo", ticks: [["✓", "Unmuted voice and media"], ["✓", "Request older films"], ["✓", "AI insights dashboard"]], hot: true },
  { badge: "VIP GROUP", kind: "vip", price: "₦2,900", per: "/seat", ticks: [["✓", "5 to 50 seats together"], ["✓", "Lower price per seat"], ["✓", "Group room and host tools"]] },
  { badge: "ENTERPRISE", kind: "enterprise", price: "₦25,000", per: "/mo", ticks: [["✓", "Watch alone or invite-only"], ["✓", "Private rooms"], ["✓", "Priority support"]] },
];

const METHODS = ["Mastercard", "Visa", "Verve", "Paystack", "Flutterwave", "M-Pesa", "UPI", "Apple Pay", "Google Pay", "Bitcoin", "USDC", "Ethereum"];
const LIVE_METHODS = new Set(["Mastercard", "Visa"]); // through PayPal today

const FOOTER: [string, [string, string][]][] = [
  ["Watch", [["Premieres", "#premieres"], ["Watch parties", "/releases"], ["Request a film", "/concierge"]]],
  ["Account", [["Plans", "#plans"], ["Student offer", "#plans"], ["Gift a seat", "/checkout"]]],
  ["Company", [["About", "/terms"], ["Studios and distributors", "mailto:admin@e-cinema.net?subject=Studios"], ["Careers", "mailto:admin@e-cinema.net?subject=Careers"]]],
  ["Help", [["Help centre", "/concierge"], ["Privacy", "/privacy"], ["Terms", "/terms"]]],
];

export default async function Home() {
  const [me, seats, h] = await Promise.all([currentAccount(), liveSeats(), headers()]);
  const { list, hero } = lineupNow();
  const heroSeats = seats[hero.id];
  const country = h.get("cf-ipcountry");
  const [l1, ...l2] = hero.film.toUpperCase().split(" ");
  const heroLines = l2.length > 1 ? [`${l1} ${l2[0]}`, l2.slice(1).join(" ")] : [l1, l2.join(" ")];
  const tiles = list.filter((s) => s.id !== hero.id).map((s) => ({ ...s, endsAtMs: endsAt(s) }));

  return (
    <div className="lp">
      <header className="lp-hero">
        <span className="lp-glow a" aria-hidden />
        <span className="lp-glow b" aria-hidden />
        <img className="lp-dunes" src="/landing/dunes.svg" alt="" aria-hidden />
        <span className="lp-fade-left" aria-hidden />
        <span className="lp-fade-bottom" aria-hidden />

        <nav className="lp-nav">
          <div className="lp-nav-left">
            <Logo />
            <div className="lp-nav-links">
              <a href="#premieres" className="on">Premieres</a>
              <Link href="/releases">Watch parties</Link>
              <a href="#plans">Plans</a>
              <a href="mailto:admin@e-cinema.net?subject=E-Cinema%20for%20business">For business</a>
            </div>
          </div>
          <div className="lp-nav-right">
            <AskAIButton />
            <span className="lp-chip static">{country && country !== "XX" ? `${country} · ` : ""}English</span>
            {me ? (
              <><Link href="/home" className="lp-btn sm">My home</Link><AccountMenu name={me.name} email={me.email} /></>
            ) : (
              <>
                <Link href="/signin" className="lp-btn sm ghost">Sign in</Link>
                <Link href="/join" className="lp-btn sm">Join free</Link>
              </>
            )}
          </div>
        </nav>

        <div className="lp-hero-copy">
          <div className="lp-badges">
            <span className="lp-badge live"><i />WORLD PREMIERE</span>
            <HeroWhen startsAt={hero.startsAt} />
          </div>
          <h1 className="lp-display-xl">{heroLines.filter(Boolean).map((l) => <span key={l}>{l}</span>)}</h1>
          <div className="lp-meta">
            {[hero.year, hero.genres?.join(", "), runtime(hero.runtimeMin)].filter(Boolean).map((m, i) => (
              <span key={i} className="lp-meta-item">{i > 0 && <i className="lp-dot" aria-hidden />}{m}</span>
            ))}
            {hero.rating && <><i className="lp-dot" aria-hidden /><span className={`lp-badge ${hero.adult ? "adult" : "outline"}`}>{hero.rating}</span></>}
          </div>
          <p className="lp-body-l">{hero.blurb ?? `${hero.film} from ${hero.studio}. One night, one screening, the whole world in the same seat.`}</p>
          <Countdown to={hero.startsAt} />
          <div className="lp-ctas">
            <Link href={`/checkout#${hero.id}`} className="lp-btn lg">Get a seat · {money(hero.price)}</Link>
            <Link href="/watch/red-earth-sample" className="lp-btn lg secondary">Hear the AI dubs</Link>
          </div>
          {heroSeats && (
            <div className="lp-seats">
              <span className="lp-bar"><span style={{ width: `${Math.round((1 - heroSeats.available / Math.max(1, heroSeats.capacity)) * 100)}%` }} /></span>
              {heroSeats.available.toLocaleString("en-US")} of {heroSeats.capacity.toLocaleString("en-US")} seats left
            </div>
          )}
        </div>
      </header>

      <section className="lp-section lp-premieres" id="premieres">
        <PremiereStrip tiles={tiles} />
      </section>

      <section className="lp-section" id="how">
        <div className="lp-titles">
          <p className="lp-eyebrow">HOW IT WORKS</p>
          <h2>A cinema seat without the cinema</h2>
        </div>
        <ol className="lp-steps">
          {STEPS.map(([n, t, d]) => (
            <li key={n} className="lp-card"><b>{n}</b><strong>{t}</strong><span>{d}</span></li>
          ))}
        </ol>
      </section>

      <section className="lp-section"><LanguageDemo /></section>

      <section className="lp-section">
        <div className="lp-titles">
          <p className="lp-eyebrow">BUILT FOR WATCHING TOGETHER</p>
          <h2>Everything a night out has, minus the traffic</h2>
        </div>
        <ul className="lp-features">
          {FEATURES.map(([icon, t, d, soon]) => (
            <li key={t} className="lp-card">
              <span className="lp-icon"><img src={`/landing/${icon}.svg`} alt="" width={22} height={22} /></span>
              <strong>{t}{soon && <em className="lp-soon">Soon</em>}</strong>
              <span>{d}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="lp-section" id="plans">
        <div className="lp-head">
          <div className="lp-titles">
            <p className="lp-eyebrow">PLANS</p>
            <h2>Choose how loud you want to be</h2>
          </div>
          <p className="lp-body-m">Prices shown for Nigeria</p>
        </div>
        <ul className="lp-plans">
          {PLANS.map((p) => (
            <li key={p.badge} className={`lp-card lp-plan${p.hot ? " hot" : ""}`}>
              <span className={`lp-badge ${p.kind}`}>{p.badge}</span>
              <div className="lp-price"><b>{p.price}</b>{p.per && <span>{p.per}</span>}</div>
              <ul className="lp-ticks">
                {p.ticks.map(([m, t]) => <li key={t} className={m === "—" ? "off" : ""}>{m}&nbsp;&nbsp;{t}</li>)}
              </ul>
            </li>
          ))}
        </ul>
        <p className="lp-note">Single tickets are on sale now. Monthly plans open when local payments go live.</p>
      </section>

      <div className="lp-surge-wrap">
        <div className="lp-surge">
          <div>
            <p className="lp-eyebrow white">SOLD OUT IN 24 HOURS?</p>
            <p className="lp-display-m">WE OPEN 1,000 FREE SEATS</p>
            <p className="lp-body-l">When a premiere sells out within a day, we release a free block of seats by lottery so demand never locks people out.</p>
          </div>
          <Link href={me ? "/releases" : "/join"} className="lp-btn lg white">Join the waitlist</Link>
        </div>
      </div>

      <section className="lp-section lp-payments">
        <h3>Pay the way your country pays</h3>
        <ul className="lp-methods">
          {METHODS.map((m) => <li key={m} className={LIVE_METHODS.has(m) ? "" : "later"}>{m}</li>)}
        </ul>
        <p className="lp-note">Cards work today through PayPal. The other methods switch on next, starting with Paystack and Flutterwave.</p>
      </section>

      <footer className="lp-footer">
        <div className="lp-footer-brand">
          <Logo />
          <p>© 2026 Online Cinema Ltd, trading as E-Cinema. Premieres, together.</p>
        </div>
        <div className="lp-footer-cols">
          {FOOTER.map(([head, links]) => (
            <div key={head}>
              <p>{head}</p>
              {links.map(([t, href]) => <a key={t} href={href}>{t}</a>)}
            </div>
          ))}
        </div>
      </footer>
    </div>
  );
}
