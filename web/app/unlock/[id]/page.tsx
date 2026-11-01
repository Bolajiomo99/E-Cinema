import Link from "next/link";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import UnlockFlow from "@/components/unlock/UnlockFlow";
import { myTickets } from "@/lib/api";
import { accountApi, currentAccount, SESSION_COOKIE } from "@/lib/auth";
import { findShowtime } from "@/lib/catalog";
import { ADULT_STAGES, quote } from "@/lib/ticket-quote";

// Built from the Figma frame "Web / 18+ unlock · four payments" (28:839).
export const dynamic = "force-dynamic";
export const metadata = { title: "18+ unlock · E-Cinema", robots: { index: false } };

const money = (cur: string, cents: number) => (cur === "USD" ? `$${(cents / 100).toFixed(2)}` : `${cur} ${(cents / 100).toFixed(2)}`);
const STAGES = [
  { name: "Charity", sub: "Goes to the E‑Cinema charity fund", icon: "heart" },
  { name: "Church pastor offering", sub: "Paid to the partner church fund", icon: "church" },
  { name: "Islamic cleric offering", sub: "Paid to the partner mosque fund", icon: "moon" },
  { name: "Access fee", sub: "", icon: "key" },
] as const;

type State = { status: { verified: boolean; verifiedAt?: string; pinSet: boolean }; stages: { stage: number; status: string; amountCents: number; currency: string }[] };

export default async function UnlockPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = findShowtime(id);
  if (!s?.adult) notFound();
  const me = await currentAccount();
  if (!me) redirect(`/signin?next=${encodeURIComponent(`/unlock/${s.id}`)}`);
  const session = (await cookies()).get(SESSION_COOKIE)?.value;
  const [st, prof, tickets] = await Promise.all([
    accountApi("GET", `/v1/me/adult/${encodeURIComponent(s.id)}`, undefined, session),
    accountApi("GET", "/v1/me/profile", undefined, session).catch(() => null),
    myTickets(session).catch(() => []),
  ]);
  const state: State = st.status === 200 ? (st.body as State) : { status: { verified: false, pinSet: false }, stages: [] };
  const q = quote(s, prof?.status === 200 ? (prof.body as { country?: string }) : undefined);
  const stageCents = Math.round(Number(q.total) * 100);
  const seat = tickets.some((t) => t.showtimeId === s.id && t.status === "paid");
  const paidFund = state.stages.filter((x) => x.status === "paid");
  const paidCount = paidFund.length + (seat ? 1 : 0);
  const paidCents = paidFund.reduce((n, x) => n + x.amountCents, 0) + (seat ? stageCents : 0);
  const totalCents = paidFund.reduce((n, x) => n + x.amountCents, 0) + stageCents * (ADULT_STAGES - paidFund.length);
  const current = seat ? 0 : paidCount + 1;
  const verifiedOn = state.status.verifiedAt ? new Date(state.status.verifiedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : "";

  return (
    <main className="ul">
      <i className="ul-glow" aria-hidden />
      <section className="ul-modal" role="dialog" aria-modal="true" aria-labelledby="ul-h">
        <header className="ul-h">
          <div><span className="ul-badge">18+</span><h1 id="ul-h">{s.film}</h1></div>
          <Link href={`/film/${s.id}`} className="ul-x" aria-label="Close">
            <svg width="22" height="22" viewBox="0 0 22 22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden><path d="M6 6l10 10M16 6 6 16" /></svg>
          </Link>
        </header>
        <p className="ul-sub">Adult titles unlock after four separate payments, one per stage. Each stage costs 10% more than the Pro upgrade ({money(q.currency, Math.round(Number(q.full) * 100 / 1.1))} + 10% = {money(q.currency, Math.round(Number(q.full) * 100))}{Number(q.vat) ? `, plus ${Math.round(q.vatRate * 1000) / 10}% VAT` : ""}).</p>
        {state.status.verified ? (
          <div className="ul-age">
            <Ico n="shield" />
            <p>Age verified with ID and face check{verifiedOn ? ` on ${verifiedOn}` : ""}{state.status.pinSet ? " · Adult PIN set" : " · Set your adult PIN below"}</p>
          </div>
        ) : (
          <div className="ul-age warn">
            <Ico n="shield" />
            <p>Adult titles need a finished ID and face check. <Link href="/settings/account">Verify your age</Link> first, then come back here.</p>
          </div>
        )}
        <ol className="ul-stages">
          {STAGES.map((x, i) => {
            const n = i + 1;
            const paid = n <= paidCount;
            const now = n === current;
            return (
              <li key={n} className={`ul-stage${paid ? " paid" : now ? " now" : ""}`}>
                <span className="ul-num">{paid ? <Ico n="check" /> : <Ico n={x.icon} />}</span>
                <span className="ul-t"><strong>Stage {n} · {x.name}</strong><small>{x.sub || `Unlocks ${s.film} on this account`}</small></span>
                <span className="ul-p"><b>{money(q.currency, paid && i < 3 ? paidFund[i]?.amountCents ?? stageCents : stageCents)}</b><em>{paid ? "Paid" : now ? "Pay now" : "Locked"}</em></span>
              </li>
            );
          })}
        </ol>
        <div className="ul-total">
          <p>Paid {money(q.currency, paidCents)} of {money(q.currency, totalCents)}</p>
          <span className="ul-bar" aria-hidden><i style={{ width: `${(paidCount / ADULT_STAGES) * 100}%` }} /></span>
        </div>
        {seat ? (
          <Link href={`/room/${s.id}`} className="ul-cta">Unlocked · go to the room lobby</Link>
        ) : q.phase === "ended" ? (
          <p className="ul-sub">This premiere has ended.</p>
        ) : (
          <UnlockFlow showtimeId={s.id} stage={current} price={money(q.currency, stageCents)} verified={state.status.verified} pinSet={state.status.pinSet} />
        )}
        <div className="ul-note">
          <Ico n="eye" />
          <p>Each stage asks for your adult PIN and a one-time code. Screenshots, recording and casting stay blocked. Downloads are tied to this device.</p>
        </div>
      </section>
    </main>
  );
}

function Ico({ n }: { n: string }) {
  const p = { width: 18, height: 18, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };
  switch (n) {
    case "check": return <svg {...p}><path d="m5 12.5 4.5 4.5L19 7.5" /></svg>;
    case "heart": return <svg {...p}><path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z" /></svg>;
    case "church": return <svg {...p}><path d="M12 3v6M9.5 5.5h5M6 21v-8l6-4 6 4v8M10 21v-4h4v4" /></svg>;
    case "moon": return <svg {...p}><path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z" /></svg>;
    case "key": return <svg {...p}><circle cx="8" cy="15" r="4" /><path d="m11 12 8-8M16 7l2 2M14 9l2 2" /></svg>;
    case "shield": return <svg {...p} stroke="#22c55e"><path d="M12 3 4.5 6v6c0 4.6 3.2 7.7 7.5 9 4.3-1.3 7.5-4.4 7.5-9V6z" /></svg>;
    default: return <svg {...p} stroke="#6e6e7a"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></svg>;
  }
}
