import Link from "next/link";
import TopNav from "@/components/dash/TopNav";
import { DashShell } from "@/components/dash/DashShell";
import LocalWhen from "@/components/dash/LocalWhen";
import RedeemButton from "@/components/gift/RedeemButton";
import LandingFooter from "@/components/landing/LandingFooter";
import { currentAccount } from "@/lib/auth";
import { findShowtime } from "@/lib/catalog";
import { describeGift, giftByCode } from "@/lib/gifts";
import { readLocale } from "@/lib/locale";

// Where a gift link lands: shows the gift and claims it for the signed-in viewer.
export const dynamic = "force-dynamic";
export const metadata = { title: "Your gift · E-Cinema", robots: { index: false } };

export default async function Redeem({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const [g, me, loc] = await Promise.all([giftByCode(code), currentAccount(), readLocale()]);
  const show = g?.showtimeId ? findShowtime(g.showtimeId) : undefined;
  const next = `/gift/redeem/${encodeURIComponent(code)}`;
  const ended = show ? Date.parse(show.startsAt) + (show.runtimeMin ?? 120) * 60_000 < Date.now() : false;

  let card;
  if (!g || g.status === "pending") {
    card = <><h1>We could not find that gift</h1><p>Check the link in your email. If it was just bought, payment can take a minute to confirm.</p><Link href="/gift" className="lp-btn">Send a gift instead</Link></>;
  } else if (g.status === "redeemed") {
    card = <><h1>This gift has been claimed</h1><p>{g.redeemedAt ? "It was claimed already. " : ""}If that was you, find it in {g.kind === "seat" ? <Link href="/tickets">My tickets</Link> : <Link href="/account">your account</Link>}.</p></>;
  } else {
    card = (
      <>
        <p className="gf-eyebrow">A GIFT FROM {(g.giverName ?? "A FRIEND").toUpperCase()}</p>
        <h1>{g.name ? `${g.name}, you` : "You"} have {describeGift(g).replace(" of E-Cinema credit", " of credit")}</h1>
        {show && <p className="gf-when"><LocalWhen iso={show.startsAt} suffix=" your time" /></p>}
        {g.message && <blockquote className="gf-msg">“{g.message}”<cite>{g.giverName}</cite></blockquote>}
        {ended ? <p className="gf-err">This premiere has already screened, so the seat can no longer be used.</p>
          : me ? <RedeemButton code={g.code ?? code} kind={g.kind} showtimeId={g.showtimeId} />
          : <div className="gf-actions"><Link href={`/join?next=${encodeURIComponent(next)}`} className="lp-btn">Join free to claim</Link><Link href={`/signin?next=${encodeURIComponent(next)}`} className="lp-btn secondary">Sign in</Link></div>}
      </>
    );
  }
  const body = (
    <div className="lp gf">
      <TopNav me={me} t={loc.t} country={loc.country} lang={loc.lang} />
      <main id="main" className="gf-redeem">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="gf-photo" src="/img/gift-card.png" alt="" width={420} height={280} />
        <section className="gf-claim">{card}</section>
      </main>
      <LandingFooter />
    </div>
  );
  return me ? <DashShell>{body}</DashShell> : body;
}
