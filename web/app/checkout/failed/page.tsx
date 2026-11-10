import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import TopNav from "@/components/dash/TopNav";
import LocalWhen from "@/components/dash/LocalWhen";
import HoldTimer from "@/components/checkout/HoldTimer";
import TryAnother from "@/components/checkout/TryAnother";
import { myTickets } from "@/lib/api";
import { accountApi, currentAccount, SESSION_COOKIE } from "@/lib/auth";
import { findShowtime } from "@/lib/catalog";
import { readLocale } from "@/lib/locale";
import { fallbacksFor, localReady, paypalReady } from "@/lib/pay-methods";
import { quote, salesOver } from "@/lib/ticket-quote";
import { quoteLabel } from "@/lib/seat-price";

// Built from the Figma frame "Web / Checkout · Payment failed" (96:1254).
// The seat stays held (10 minutes from the first try) while the viewer picks another way to pay.
export const dynamic = "force-dynamic";
export const metadata = { title: "Payment did not go through · E-Cinema" };

const REASONS: Record<string, string> = {
  INSTRUMENT_DECLINED: "Your bank declined the card.",
  CARD_EXPIRED: "The card has expired.",
  INSUFFICIENT_FUNDS: "The card does not have enough funds.",
  PAYER_ACTION_REQUIRED: "Your bank asked for an extra check that did not finish.",
  TRANSACTION_REFUSED: "PayPal refused this payment.",
  PAYER_CANNOT_PAY: "PayPal could not take this payment from your account.",
};

export default async function PaymentFailed({ searchParams }: { searchParams: Promise<{ film?: string; q?: string; why?: string }> }) {
  const [{ film, q: quality, why }, me, loc] = await Promise.all([searchParams, currentAccount(), readLocale()]);
  const s = film ? findShowtime(film) : undefined;
  if (!s) redirect("/checkout");
  const retry = `/checkout?film=${s.id}${quality && quality !== "hd" ? `&q=${quality}` : ""}`;
  if (!me) redirect(`/signin?next=${encodeURIComponent(retry)}`);

  const session = (await cookies()).get(SESSION_COOKIE)?.value;
  const [tickets, prof] = await Promise.all([
    myTickets(session).catch(() => []),
    session ? accountApi("GET", "/v1/me/profile", undefined, session).catch(() => null) : null,
  ]);
  if (tickets.some((t) => t.showtimeId === s.id && t.status === "paid")) redirect(`/tickets/confirmed?film=${s.id}`);
  const now = Date.now();
  const hold = tickets.find((t) => t.showtimeId === s.id && t.status === "held" && Date.parse(t.expiresAt) > now);
  const profile = prof?.status === 200 ? (prof.body as { plan?: string; planStatus?: string; country?: string }) : undefined;
  const country = profile?.country || loc.country;
  const q = quote(s, profile ? { ...profile, country } : undefined, now, quality);
  const total = await quoteLabel(s, { currency: q.currency, value: q.total }, country);

  return (
    <>
      <TopNav me={me} t={loc.t} country={loc.country} lang={loc.lang} />
      <main id="main" className="pf">
        <section className="pf-card" aria-labelledby="pf-h">
          <span className="pf-ic" aria-hidden>
            <svg width="30" height="30" viewBox="0 0 30 30" fill="none" stroke="#e3182d" strokeWidth="2.2" strokeLinecap="round"><path d="M9 9l12 12M21 9 9 21" /></svg>
          </span>
          <h1 id="pf-h">Payment did not go through</h1>
          <p className="pf-sub">
            {REASONS[why ?? ""] ?? "The payment did not finish."} You have not been charged.{" "}
            {hold ? "Your seat is held for 10 minutes." : "Your seat hold has ended, but seats may still be free. Paying again holds a new one."}
          </p>
          {hold && (
            <div className="pf-hold">
              <span>Seat held for {s.film} · <LocalWhen iso={s.startsAt} /></span>
              <HoldTimer until={hold.expiresAt} />
            </div>
          )}
          {salesOver(q.phase)
            ? <p className="pf-sub">{q.phase === "ended" ? "This premiere has ended." : "Doors have closed for this premiere."} <Link href="/browse">Find another one</Link>.</p>
            : <TryAnother options={fallbacksFor(country, paypalReady(), localReady())} showtimeId={s.id} quality={q.quality} total={total} retryHref={retry} />}
        </section>
      </main>
    </>
  );
}
