import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import AgentCard from "@/components/ai/AgentCard";
import AskAIButton from "@/components/ai/AskAIButton";
import ConciergeChat from "@/components/ai/ConciergeChat";
import { TicketsProvider } from "@/components/ai/tickets";
import WeekCalendar from "@/components/ai/WeekCalendar";
import Countdown from "@/components/Countdown";
import Logo from "@/components/landing/Logo";
import AccountMenu from "@/components/AccountMenu";
import { DashShell, SidebarToggle } from "@/components/dash/DashShell";
import PremiereStrip from "@/components/landing/PremiereStrip";
import { liveStats, myTickets } from "@/lib/api";
import LiveAudience from "@/components/dash/LiveAudience";
import PartiesRow from "@/components/home/PartiesRow";
import ClipsRow from "@/components/home/ClipsRow";
import ClassicCard from "@/components/home/ClassicCard";
import type { Classic } from "@/lib/classics";
import type { Party } from "@/lib/parties";
import { accountApi, currentAccount, SESSION_COOKIE } from "@/lib/auth";
import { endsAt, showtimes } from "@/lib/catalog";
import LocalePicker from "@/components/LocalePicker";
import { readLocale } from "@/lib/locale";
import { SPEND_LIMIT } from "@/lib/concierge";

// Built from the Figma frame "Web / Home · AI concierge and release calendar" (298:1362).
export const dynamic = "force-dynamic";
export const metadata = { title: "Home · E-Cinema" };

// Announced titles without tickets yet, shown on the calendar so viewers can plan ahead.
const ANNOUNCED = [
  { id: "paper-moon-riders", film: "Paper Moon Riders", startsAt: "2026-11-05T16:00:00Z", price: { currency: "USD", value: "0" }, category: "Anime", language: "Japanese" },
  { id: "the-last-glacier", film: "The Last Glacier", startsAt: "2026-11-06T19:00:00Z", price: { currency: "USD", value: "0" }, category: "Documentary", language: "English" },
] as const;

function pick() {
  const now = Date.now();
  const open = showtimes.filter((s) => endsAt(s) > now);
  const list = open.length ? open : showtimes;
  const live = list.find((s) => Date.parse(s.startsAt) <= now);
  const hero = live ?? list.find((s) => s.featured) ?? list[0];
  return { list, hero, live: Boolean(live) };
}

export default async function Home() {
  const [me, loc] = await Promise.all([currentAccount(), readLocale()]);
  const { t } = loc;
  if (!me) redirect("/signin?next=/home");
  const session = (await cookies()).get(SESSION_COOKIE)?.value;
  const [tickets, stats, partyRes, classicRes] = await Promise.all([
    myTickets(session).catch(() => []),
    liveStats(),
    accountApi("GET", "/v1/me/parties", undefined, session).catch(() => null),
    accountApi("GET", "/v1/classics", undefined, session).catch(() => null),
  ]);
  const topClassic = classicRes?.status === 200 && Array.isArray(classicRes.body) ? (classicRes.body as Classic[])[0] : undefined;
  const parties = partyRes?.status === 200 && Array.isArray(partyRes.body) ? (partyRes.body as Party[]) : [];
  const { list, hero, live } = pick();
  const heroStat = stats.find((x) => x.showtimeId === hero.id);
  // The room opens 30 minutes before the premiere for ticket holders.
  const lobbyOpen = !live && Date.parse(hero.startsAt) - Date.now() < 30 * 60_000;
  const heroTicket = tickets.find((t) => t.showtimeId === hero.id && t.status === "paid");
  const tiles = list.map((s) => ({ ...s, endsAtMs: endsAt(s) }));
  const calendar = [
    ...tiles.map(({ id, film, startsAt, price, category, adult, dubs, language, endsAtMs }) => ({ id, film, startsAt, price, category, adult, dubs, language, endsAtMs })),
    ...ANNOUNCED.map((a) => ({ ...a, price: { ...a.price }, category: a.category as never, endsAtMs: Date.parse(a.startsAt) + 7_200_000, soon: true })),
  ];
  const [l1, ...l2] = hero.film.toUpperCase().split(" ");
  const heroLines = l2.length > 1 ? [`${l1} ${l2[0]}`, l2.slice(1).join(" ")] : [l1, l2.join(" ")];
  const first = me.name.split(" ")[0] || "there";
  // Accounts made in the last day are greeted as new, not "welcome back".
  const isNew = Date.now() - Date.parse(me.createdAt) < 24 * 3600_000;

  return (
    <TicketsProvider initial={tickets}>
      <DashShell>
      <div className="lp hm">
        <header className="lp-hero hm-hero">
          <span className="lp-glow a" aria-hidden />
          <span className="lp-glow b" aria-hidden />
          <span className="lp-fade-left" aria-hidden />
          <span className="lp-fade-bottom" aria-hidden />
          <nav className="lp-nav hm-nav">
            <div className="lp-nav-left">
              <span className="dash-brand"><SidebarToggle /><Logo /></span>
              <div className="lp-nav-links">
                <Link href="/home" className="on">{t.home}</Link>
                <Link href="/releases">{t.comingSoon}</Link>
                <a href="#calendar">{t.calendar}</a>
                <a href="#live">{t.live}</a>
                <a href="#hm-clips">Clips</a>
                {["Community", "Shop", "Library"].map((l) => (
                  <span key={l} className="soon" title={`${l} is coming soon`} aria-disabled="true">{l}</span>
                ))}
              </div>
            </div>
            <div className="lp-nav-right">
              <AskAIButton />
              <span className="hm-icon soon" title="Search is coming soon. Ask AI can find any film for you now." aria-label="Search, coming soon" role="img">
                <svg width="22" height="22" viewBox="0 0 22 22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><circle cx="10.08" cy="10.08" r="7.33" /><path d="m19.25 19.25-3.94-3.94" /></svg>
              </span>
              <span className="hm-icon soon" title="Notifications are coming soon" aria-label="Notifications, coming soon" role="img">
                <svg width="22" height="22" viewBox="0 0 22 22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M5.5 7.33a5.5 5.5 0 0 1 11 0c0 6.42 2.75 8.25 2.75 8.25H2.75S5.5 13.75 5.5 7.33Z" /></svg>
              </span>
              <span className="hm-icon soon" title="The merch cart is coming soon" aria-label="Cart, coming soon" role="img">
                <svg width="22" height="22" viewBox="0 0 22 22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><circle cx="7.33" cy="19.25" r=".92" /><circle cx="17.42" cy="19.25" r=".92" /><path d="M1.88 1.88h1.83l2.44 11.38a1.83 1.83 0 0 0 1.83 1.45h8.97a1.83 1.83 0 0 0 1.79-1.44l1.51-6.81H4.69" /></svg>
              </span>
              <LocalePicker country={loc.country} lang={loc.lang} signedIn />
              <AccountMenu name={me.name} email={me.email} />
            </div>
          </nav>
          <div className="lp-hero-copy hm-hero-copy">
            <div className="lp-badges">
              {live ? (
                <><span className="lp-badge live pulse"><i />{t.liveNow}</span><LiveAudience showtimeId={hero.id} initial={heroStat} /></>
              ) : (
                <><span className="lp-badge live"><i />{t.worldPremiere}</span><span className="lp-badge outline">{isNew ? t.welcome : t.welcomeBack}, {first.toUpperCase()}</span></>
              )}
            </div>
            <h1 className="lp-display-xl">{heroLines.filter(Boolean).map((l) => <span key={l}>{l}</span>)}</h1>
            <p className="lp-body-l">{hero.blurb ?? `${hero.film} from ${hero.studio}. Screens once, dubbed live in ${hero.dubs ?? 3} languages.`}</p>
            {!live && <Countdown to={hero.startsAt} />}
            <div className="lp-ctas">
              {heroTicket ? (
                <Link href={`/room/${hero.id}`} className="lp-btn lg">{live ? t.joinTheRoom : lobbyOpen ? "Join the waiting room" : "Open my room"}</Link>
              ) : (
                <Link href={`/checkout?film=${hero.id}`} className="lp-btn lg">{t.getASeat} · ${hero.price.value}</Link>
              )}
              {live || lobbyOpen ? (
                <Link href={`/parties/new?film=${hero.id}`} className="lp-btn lg secondary">{t.startWatchParty}</Link>
              ) : (
                <a href={`/api/calendar/${hero.id}.ics`} className="lp-btn lg secondary">{t.addToCalendar}</a>
              )}
            </div>
          </div>
        </header>

        <section className="hm-band" aria-label="Ask E-Cinema AI">
          <div className="hm-concierge">
            <div className="hm-ask">
              <div className="hm-ask-head">
                <span className="ai-orb" aria-hidden>✦</span>
                <div>
                  <h2 className="hm-ask-title">Ask E-Cinema AI</h2>
                  <p>Your concierge finds the film, holds the seats and builds the PayPal order. You approve every payment.</p>
                </div>
                <span className="lp-badge outline">AGENT · PAYPAL</span>
              </div>
              <ConciergeChat />
            </div>
            <AgentCard films={showtimes.map(({ id, film, startsAt, price }) => ({ id, film, startsAt, price }))} limit={SPEND_LIMIT} />
          </div>
        </section>

        <section className="lp-section hm-strip" id="live">
          <PremiereStrip tiles={tiles} eyebrow="STARTING SOON" title="Each title screens once" />
        </section>

        <PartiesRow parties={parties} heroId={hero.id} />
        <ClipsRow films={list} />
        <ClassicCard top={topClassic} />

        <WeekCalendar items={calendar} />

        <footer className="lp-footer">
          <div className="lp-footer-brand">
            <Logo />
            <p>© 2026 Online Cinema Ltd, trading as E-Cinema. Premieres, together.</p>
          </div>
          <div className="lp-footer-cols">
            <div><p>Help</p><a href="/privacy">Privacy</a><a href="/terms">Terms</a></div>
            <div><p>Account</p><a href="/settings/security">Devices and security</a><a href="/checkout">Buy a seat</a></div>
          </div>
        </footer>
      </div>
      </DashShell>
    </TicketsProvider>
  );
}
