import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import Logo from "@/components/landing/Logo";
import LocalWhen from "@/components/dash/LocalWhen";
import Methods from "@/components/checkout/Methods";
import { methodsFor } from "@/lib/pay-methods";
import HashToFilm from "@/components/checkout/HashToFilm";
import PayPalTicketButton from "@/components/PayPalTicketButton";
import { myTickets } from "@/lib/api";
import { accountApi, currentAccount, SESSION_COOKIE } from "@/lib/auth";
import { endsAt, findShowtime, showtimes } from "@/lib/catalog";
import { langName } from "@/lib/i18n";
import { readLocale } from "@/lib/locale";
import { countryName } from "@/lib/plans";
import { QUALITIES, quote } from "@/lib/ticket-quote";

// Built from the Figma frame "Web / Checkout" (18:533). Prices come from the same quote the
// PayPal order uses, so the total here is the total PayPal charges.
export const dynamic = "force-dynamic";
export const metadata = { title: "Checkout · E-Cinema" };

const money = (cur: string, v: string) => (cur === "USD" ? `$${v}` : `${cur} ${v}`);

export default async function CheckoutPage({ searchParams }: { searchParams: Promise<{ film?: string; q?: string }> }) {
  const [{ film, q: quality }, me, loc] = await Promise.all([searchParams, currentAccount(), readLocale()]);
  const s = film ? findShowtime(film) : undefined;

  if (!s) {
    const open = showtimes.filter((x) => endsAt(x) > Date.now());
    return (
      <main className="co">
        <HashToFilm />
        <div className="co-pay">
          <Logo href={me ? "/home" : "/"} />
          <h1 className="co-h1">Pick a premiere</h1>
          <p className="co-eyebrow">EACH TITLE SCREENS ONCE</p>
          <div className="co-methods">
            {(open.length ? open : showtimes).map((x) => (
              <Link key={x.id} href={`/checkout?film=${x.id}`} className="co-method">
                <span className="co-mini" style={{ background: `linear-gradient(180deg, ${x.poster?.from ?? "#1b1b21"}, ${x.poster?.to ?? "#000"})` }} />
                <span className="co-t"><strong>{x.film}</strong><small><LocalWhen iso={x.startsAt} /> · {x.studio}</small></span>
                <span className="co-price">{money(x.price.currency, x.price.value)}</span>
              </Link>
            ))}
          </div>
        </div>
      </main>
    );
  }

  if (s.adult) redirect(`/unlock/${s.id}`);
  const session = (await cookies()).get(SESSION_COOKIE)?.value;
  let profile: { plan?: string; planStatus?: string; country?: string; audioLanguage?: string } | undefined;
  if (me && session) {
    const r = await accountApi("GET", "/v1/me/profile", undefined, session);
    if (r.status === 200) profile = r.body as typeof profile;
  }
  const owned = me ? (await myTickets(session).catch(() => [])).find((t) => t.showtimeId === s.id && t.status === "paid") : undefined;
  const country = profile?.country || loc.country;
  const q = quote(s, profile ? { ...profile, country } : { country: undefined }, Date.now(), quality);
  const methods = methodsFor(country, Boolean(process.env.PAYPAL_CLIENT_ID));
  const p = s.poster ?? { from: "#1b1b21", via: "#0e0e12", to: "#000", glow: "rgba(227,24,45,.45)" };
  const planName = q.member ? q.member.charAt(0).toUpperCase() + q.member.slice(1) : "";
  const back = `/checkout?film=${s.id}${q.quality === "hd" ? "" : `&q=${q.quality}`}`;
  const qualName = q.quality === "hd" ? "" : ` · ${QUALITIES.find((x) => x.id === q.quality)!.name}`;

  return (
    <main className="co">
      <div className="co-pay">
        <Logo href={me ? "/home" : "/"} />
        <Link href={me ? "/home" : "/"} className="su-back">← Back to premieres</Link>
        <h1 className="co-h1">Checkout</h1>
        <p className="co-eyebrow">PAYMENT OPTIONS FOR {(countryName(country) || "your country").toUpperCase()}</p>
        <Methods methods={methods} />
        <p className="co-note">Paystack, Flutterwave, bank transfer and crypto switch on as soon as each provider approves our account. Until then PayPal takes cards from every country we sell in.</p>
      </div>

      <aside className="co-sum" aria-label="Order summary">
        <h2>Order summary</h2>
        <div className="co-item">
          <span className="co-poster" style={{ background: `linear-gradient(180deg, ${p.from} 0%, ${p.via} 60%, ${p.to} 100%)` }}><i style={{ background: `radial-gradient(circle, ${p.glow}, transparent 70%)` }} /></span>
          <div className="co-t">
            <strong>{s.film} · {q.preorderSave ? "Pre-order seat" : "Premiere seat"}{qualName}</strong>
            <small><LocalWhen iso={s.startsAt} /> · {s.studio}</small>
            <small>Audio: {profile?.audioLanguage && profile.audioLanguage !== "en" ? `${langName(profile.audioLanguage)} (AI)` : s.language ?? "Original"} · Subtitles: {langName(loc.lang)}</small>
          </div>
        </div>
        <hr />
        {q.preorderSave > 0
          ? <p className="co-line"><span>Seat · pre-order price (save {q.preorderSave}%, {money(q.currency, q.full)} on release day)</span><span>{money(q.currency, q.seat)}</span></p>
          : <p className="co-line"><span>Seat</span><span>{money(q.currency, q.seat)}</span></p>}
        {Number(q.late) > 0 && <p className="co-line"><span>Late entry (after the first 15 minutes)</span><span>{money(q.currency, q.late)}</span></p>}
        {q.member ? (
          <p className="co-line"><span>{planName} member discount</span><span className="co-good">−{money(q.currency, q.discount)}</span></p>
        ) : (
          <p className="co-line co-hint"><span>Members save 10% on every seat</span><Link href="/plans">See plans</Link></p>
        )}
        {q.vatRate > 0 && <p className="co-line"><span>VAT ({(q.vatRate * 100).toFixed(q.vatRate * 1000 % 10 ? 1 : 0)}%)</span><span>{money(q.currency, q.vat)}</span></p>}
        <hr />
        <p className="co-total"><span>Total</span><b>{money(q.currency, q.total)}</b></p>
        {q.phase === "grace" && <p className="co-owned">The film has started. Join in the first 15 minutes at the normal price; after that, late entry costs double.</p>}
        {q.phase === "ended" ? (
          <p className="co-owned">This premiere has ended. <Link href="/browse">Find another one</Link>.</p>
        ) : owned ? (
          <>
            <p className="co-owned">You already have a seat for this premiere.</p>
            <Link href={`/room/${s.id}`} className="lp-btn lg co-cta">Go to the room lobby</Link>
          </>
        ) : me ? (
          <PayPalTicketButton showtimeId={s.id} quality={q.quality} label={`Continue to PayPal · ${money(q.currency, q.total)}`} className="lp-btn lg co-cta" />
        ) : (
          <>
            <Link href={`/signin?next=${encodeURIComponent(back)}`} className="lp-btn lg co-cta">Sign in to buy · {money(q.currency, q.total)}</Link>
            <Link href={`/join?next=${encodeURIComponent(back)}`} className="lp-btn lg secondary co-cta">Join free</Link>
          </>
        )}
        {s.adult && <p className="co-sec">18+ screening. You need a finished face and ID check to book.</p>}
        {q.preorderSave > 0 && <p className="co-sec">Free cancellation until 7 days before the screening, refunded in full to how you paid.</p>}
        <p className="co-sec">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="2" aria-hidden><path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z" /></svg>
          You pay on PayPal&apos;s own page. E‑Cinema never sees or stores your card number.
        </p>
      </aside>
    </main>
  );
}
