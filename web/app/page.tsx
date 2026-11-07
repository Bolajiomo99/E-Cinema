import Link from "next/link";
import AskAIButton from "@/components/ai/AskAIButton";
import Countdown from "@/components/Countdown";
import HeroWhen from "@/components/landing/HeroWhen";
import LanguageDemo from "@/components/landing/LanguageDemo";
import Logo from "@/components/landing/Logo";
import LandingFooter from "@/components/landing/LandingFooter";
import AccountMenu from "@/components/AccountMenu";
import PremiereStrip from "@/components/landing/PremiereStrip";
import PlanPickLink from "@/components/plans/PlanPickLink";
import TrailerButton from "@/components/landing/TrailerButton";
import LocalePicker from "@/components/LocalePicker";
import { readLocale } from "@/lib/locale";
import { countryName, currencyFor, money as planMoney, priceOf, type PlanId } from "@/lib/plans";
import { currentAccount } from "@/lib/auth";
import { endsAt, showtimes, nextPerFilm } from "@/lib/catalog";

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
  const open = nextPerFilm(showtimes.filter((s) => endsAt(s) > now));
  const list = open.length ? open : showtimes;
  const hero = list.find((s) => s.featured && Date.parse(s.startsAt) > now) ?? list.find((s) => Date.parse(s.startsAt) > now) ?? list[0];
  return { list, hero };
}

const money = (p: { currency: string; value: string }) => (p.currency === "USD" ? `$${p.value}` : `${p.currency} ${p.value}`);
const runtime = (m?: number) => (m ? `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m` : "");

const STEPS = [
  ["01", "Pick tonight's premiere", "Only new releases, screened live at set times. Miss the premiere and catch the weekly encore."],
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

const PLANS: { id: PlanId; badge: string; kind: string; per: string; ticks: string[][]; hot?: boolean }[] = [
  { id: "free", badge: "FREE", kind: "outline", per: "", ticks: [["✓", "Buy single tickets"], ["✓", "Read chat and react"], ["—", "Muted in chat"]] },
  { id: "student", badge: "STUDENT", kind: "student", per: "/mo", ticks: [["✓", "Most Pro features"], ["✓", "Verified school email"], ["✓", "2 premieres a month"]] },
  { id: "pro", badge: "PRO", kind: "pro", per: "/mo", ticks: [["✓", "Unmuted voice and media"], ["✓", "Request older films"], ["✓", "AI insights dashboard"]], hot: true },
  { id: "vip", badge: "VIP GROUP", kind: "vip", per: "/seat", ticks: [["✓", "5 to 50 seats together"], ["✓", "Lower price per seat"], ["✓", "Group room and host tools"]] },
  { id: "enterprise", badge: "ENTERPRISE", kind: "enterprise", per: "/mo", ticks: [["✓", "Watch alone or invite-only"], ["✓", "Private rooms"], ["✓", "Priority support"]] },
];

const METHODS = ["Mastercard", "Visa", "Verve", "Paystack", "Flutterwave", "M-Pesa", "UPI", "Apple Pay", "Google Pay", "Bitcoin", "USDC", "Ethereum"];
const LIVE_METHODS = new Set(["Mastercard", "Visa"]); // through PayPal today


export default async function Home() {
  const [me, seats, loc] = await Promise.all([currentAccount(), liveSeats(), readLocale()]);
  const { t } = loc;
  const { list, hero } = lineupNow();
  const heroSeats = seats[hero.id];
  const planCountry = loc.country;
  const planCurrency = currencyFor(planCountry);
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
              <a href="#premieres" className="on">{t.premieres}</a>
              <Link href="/releases">{t.watchParties}</Link>
              <Link href="/plans">{t.plans}</Link>
              <a href="mailto:admin@e-cinema.net?subject=E-Cinema%20for%20business">{t.forBusiness}</a>
            </div>
          </div>
          <div className="lp-nav-right">
            <AskAIButton />
            <LocalePicker country={loc.country} lang={loc.lang} signedIn={Boolean(me)} />
            {me ? (
              <><Link href="/home" className="lp-btn sm">{t.myHome}</Link><AccountMenu name={me.name} email={me.email} /></>
            ) : (
              <>
                <Link href="/signin" className="lp-btn sm ghost">{t.signIn}</Link>
                <Link href="/join" className="lp-btn sm">{t.joinFree}</Link>
              </>
            )}
          </div>
        </nav>

        <div className="lp-hero-copy">
          <div className="lp-badges">
            <span className="lp-badge live"><i />{hero.encoreOf ? (hero.studioFilm ? "ENCORE" : "WEEKLY ENCORE") : t.worldPremiere}</span>
            <HeroWhen startsAt={hero.startsAt} encore={Boolean(hero.encoreOf)} />
          </div>
          <h1 className="lp-display-xl">{heroLines.filter(Boolean).map((l) => <span key={l}>{l}</span>)}</h1>
          <div className="lp-meta">
            {[hero.year, hero.genres?.join(", "), runtime(hero.runtimeMin)].filter(Boolean).map((m, i) => (
              <span key={i} className="lp-meta-item">{i > 0 && <i className="lp-dot" aria-hidden />}{m}</span>
            ))}
            {hero.rating && <><i className="lp-dot" aria-hidden /><span className={`lp-badge ${hero.adult ? "adult" : "outline"}`}>{hero.rating}</span></>}
          </div>
          <p className="lp-body-l">{hero.blurb ?? `${hero.film} from ${hero.studio}. One live screening, the whole world in the same seat.`}</p>
          <Countdown to={hero.startsAt} />
          <div className="lp-ctas">
            <Link href={`/checkout?film=${hero.id}`} className="lp-btn lg">{t.getASeat} · {money(hero.price)}</Link>
            <TrailerButton film={hero.id} title={hero.film} className="lp-btn lg secondary" label={t.watchTrailer} />
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
          <p className="lp-eyebrow">{t.howItWorks}</p>
          <h2>{t.howTitle}</h2>
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
          <p className="lp-eyebrow">{t.builtFor}</p>
          <h2>{t.builtTitle}</h2>
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
            <p className="lp-eyebrow">{t.plansEyebrow}</p>
            <h2>{t.plansTitle}</h2>
          </div>
          <p className="lp-body-m">Prices shown for {countryName(planCountry) || "your country"} · <a href="#locale" data-open-locale>Change country</a> · <Link href="/plans">{t.compare}</Link></p>
        </div>
        <ul className="lp-plans">
          {PLANS.map((p) => (
            <li key={p.badge}>
              <PlanPickLink plan={p.id} signedIn={Boolean(me)} className="lp-card lp-plan">
                <span className="lp-plan-top"><span className={`lp-badge ${p.kind}`}>{p.badge}</span>{p.hot && <em>Most popular</em>}</span>
                <div className="lp-price"><b>{planMoney(priceOf(p.id, planCurrency), planCurrency)}</b>{p.per && <span>{p.per}</span>}</div>
                <ul className="lp-ticks">
                  {p.ticks.map(([m, t]) => <li key={t} className={m === "—" ? "off" : ""}>{m}&nbsp;&nbsp;{t}</li>)}
                </ul>
                <span className="lp-plan-cta">{p.id === "free" ? (me ? "Compare plans" : "Join free") : `Choose ${p.badge === "VIP GROUP" ? "VIP group" : p.badge.charAt(0) + p.badge.slice(1).toLowerCase()}`} →</span>
              </PlanPickLink>
            </li>
          ))}
        </ul>
        <p className="lp-note">Pay for any plan with PayPal today. Paystack, Flutterwave and crypto switch on next.</p>
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
        <h3>{t.payTitle}</h3>
        <ul className="lp-methods">
          {METHODS.map((m) => <li key={m} className={LIVE_METHODS.has(m) ? "" : "later"}>{m}</li>)}
        </ul>
        <p className="lp-note">Cards work today through PayPal. The other methods switch on next, starting with Paystack and Flutterwave.</p>
      </section>

      <LandingFooter heads={{ Watch: t.watch, Account: t.account, Company: t.company, Help: t.help }} />
    </div>
  );
}
