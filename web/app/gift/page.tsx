import TopNav from "@/components/dash/TopNav";
import { DashShell } from "@/components/dash/DashShell";
import GiftBuilder, { type GiftShow } from "@/components/gift/GiftBuilder";
import LandingFooter from "@/components/landing/LandingFooter";
import { currentAccount } from "@/lib/auth";
import { showtimes } from "@/lib/catalog";
import { giftable, giftPrice, sweepGifts } from "@/lib/gifts";
import { readLocale } from "@/lib/locale";

// Built from the Figma frame "Web / Gift a seat" (94:1398).
export const dynamic = "force-dynamic";
export const metadata = { title: "Gift a seat · E-Cinema", description: "Gift a premiere seat, a plan or credit to anyone in any country." };

export default async function GiftPage({ searchParams }: { searchParams: Promise<{ film?: string; kind?: string }> }) {
  const [sp, me, loc] = await Promise.all([searchParams, currentAccount(), readLocale()]);
  void sweepGifts();
  const now = Date.now();
  const shows: GiftShow[] = showtimes
    .filter((s) => giftable(s, now) && Date.parse(s.startsAt) > now)
    .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt))
    .map((s) => ({ id: s.id, film: s.film, startsAt: s.startsAt, ...(({ cents, currency }) => ({ cents, currency }))(giftPrice("seat", { showtime: s })!) }));
  const kind = (["seat", "pro1", "vip3", "credit"] as const).find((k) => k === sp.kind);

  const body = (
    <div className="lp gf">
      <TopNav me={me} t={loc.t} country={loc.country} lang={loc.lang} />
      <header className="gf-hero">
        <div className="gf-copy">
          <p className="gf-eyebrow">GIFT A SEAT</p>
          <h1>SEND SOMEONE A PREMIERE NIGHT.</h1>
          <p className="lp-body-l">Gift a ticket, a plan or credit to anyone in any country. They get it by email or WhatsApp, and can use it wherever they live.</p>
        </div>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="gf-photo" src="/img/gift-card.png" alt="A black E-Cinema gift card with a red ribbon" width={420} height={280} />
      </header>
      <main className="gf-main">
        <h2>Build your gift</h2>
        <GiftBuilder shows={shows} prices={{ pro1: giftPrice("pro1", {})!.cents, vip3: giftPrice("vip3", {})!.cents }} signedIn={Boolean(me)} initialFilm={sp.film} initialKind={kind} />
      </main>
      <LandingFooter />
    </div>
  );
  return me ? <DashShell>{body}</DashShell> : body;
}
