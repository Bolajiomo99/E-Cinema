import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { DashShell, SidebarToggle } from "@/components/dash/DashShell";
import LocalWhen from "@/components/dash/LocalWhen";
import CancelSeat from "@/components/tickets/CancelSeat";
import { myTickets, type MyTicket } from "@/lib/api";
import { currentAccount, SESSION_COOKIE } from "@/lib/auth";
import { endsAt, findShowtime, type Showtime } from "@/lib/catalog";
import { creditBalance, describeGift, sentGifts, type Gift } from "@/lib/gifts";

// Built from the Figma frame "Web / My tickets" (31:605).
export const dynamic = "force-dynamic";
export const metadata = { title: "My tickets · E-Cinema" };

type Row = MyTicket & { show: Showtime };
const ROOM_OPENS = 30 * 60_000; // the room opens half an hour before the film
const CANCEL_UNTIL = 7 * 86_400_000; // free cancellation until 7 days before

export default async function Tickets({ searchParams }: { searchParams: Promise<{ view?: string; sent?: string }> }) {
  const me = await currentAccount();
  if (!me) redirect("/signin?next=/tickets");
  const session = (await cookies()).get(SESSION_COOKIE)?.value;
  const sp = await searchParams;
  const view = sp.view === "past" ? "past" : sp.view === "gifted" ? "gifted" : "upcoming";
  const now = Date.now();
  const [tickets, gifts, credit] = await Promise.all([myTickets(session).catch(() => []), session ? sentGifts(session) : [], session ? creditBalance(session) : 0]);
  const rows = tickets
    .map((t) => ({ ...t, show: findShowtime(t.showtimeId) }))
    .filter((t): t is Row => Boolean(t.show));
  const upcoming = rows.filter((t) => endsAt(t.show) > now);
  const past = rows.filter((t) => endsAt(t.show) <= now && t.status === "paid").reverse();
  const list = view === "past" ? past : view === "gifted" ? [] : upcoming;

  return (
    <DashShell defaultOpen>
      <main id="main" className="tk">
        <div className="tk-head">
          <div>
            <div className="tk-title"><SidebarToggle /><h1>My tickets</h1></div>
            <p>Upcoming seats and past screenings</p>
          </div>
          <div className="tk-chips" role="tablist">
            <Link href="/tickets" role="tab" aria-selected={view === "upcoming"} className={view === "upcoming" ? "on" : ""}>Upcoming {upcoming.length}</Link>
            <Link href="/tickets?view=past" role="tab" aria-selected={view === "past"} className={view === "past" ? "on" : ""}>Past {past.length}</Link>
            <Link href="/tickets?view=gifted" role="tab" aria-selected={view === "gifted"} className={view === "gifted" ? "on" : ""}>Gifted {gifts.length}</Link>
          </div>
        </div>

        {view === "gifted" && (
          <>
            {sp.sent && <p className="tk-sent" role="status">Paid. Your gift is on its way, and it shows here until it is claimed.</p>}
            {credit > 0 && <p className="tk-sent">You have ${(credit / 100).toFixed(2)} of credit. It pays for seats at checkout.</p>}
            {gifts.length === 0 ? (
              <div className="tk-empty">
                <h2>No gifts sent yet</h2>
                <p>Send a premiere seat, a plan or credit to anyone in any country.</p>
                <Link href="/gift" className="state-btn primary">Gift a seat</Link>
              </div>
            ) : gifts.map((g) => <GiftRow key={g.id} g={g} now={now} />)}
          </>
        )}

        {view !== "gifted" && list.length === 0 && (
          <div className="tk-empty">
            <h2>{view === "past" ? "No past screenings yet" : "No seats yet"}</h2>
            <p>{view === "past" ? "Films you have watched show up here after the credits." : "Every title screens once. Pick one and your seat shows up here."}</p>
            <Link href="/releases" className="state-btn primary">See what is on</Link>
          </div>
        )}

        {list.map((t) => <TicketRow key={t.holdId} t={t} now={now} past={view === "past"} />)}

        <div className="tk-note">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden><rect x="4.5" y="10.5" width="15" height="10" rx="2" /><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" /></svg>
          <p>Cancel free until 7 days before a screening and get a full refund to how you paid. If a studio moves a premiere you can take a full refund for 7 days. If a premiere is cancelled you are refunded automatically. Gifts you send arrive on the day you pick.</p>
        </div>
      </main>
    </DashShell>
  );
}

function TicketRow({ t, now, past }: { t: Row; now: number; past: boolean }) {
  const s = t.show;
  const start = Date.parse(s.startsAt);
  const mins = Math.round((start - now) / 60_000);
  const live = start <= now && endsAt(s) > now;
  const open = t.status === "paid" && start - now <= ROOM_OPENS && !past;
  const p = s.poster ?? { from: "#1b1b21", via: "#0e0e12", to: "#000", glow: "transparent" };
  const words = s.film.toUpperCase().split(" ");
  const half = Math.ceil(words.length / 2);
  return (
    <article className="tk-row">
      <div className="tk-poster" style={{ background: `linear-gradient(180deg, ${p.from}, ${p.via} 60%, ${p.to})` }} aria-hidden>
        <i style={{ background: `radial-gradient(circle, ${p.glow}, transparent 70%)` }} />
        <span>{words.slice(0, half).join(" ")}<br />{words.slice(half).join(" ")}</span>
      </div>
      <div className="tk-info">
        <h2>{s.film.toUpperCase()}</h2>
        <p><LocalWhen iso={s.startsAt} suffix={s.language ? ` · ${s.language}` : ""} /></p>
        <div className="tk-badges">
          {t.status === "held" ? <span className="b warn">PAYMENT PENDING</span>
            : past ? <span className="b out">WATCHED</span>
            : live ? <span className="b live"><i />LIVE NOW</span>
            : mins <= 180 ? <span className="b live"><i />STARTS IN {mins >= 60 ? `${Math.floor(mins / 60)} H ${mins % 60} MIN` : `${mins} MIN`}</span>
            : mins <= 24 * 60 ? <span className="b white">TONIGHT</span> : null}
          <span className="b out">{t.seats} {t.seats === 1 ? "SEAT" : "SEATS"}</span>
          {t.quality && t.quality !== "hd" && <span className="b out">{t.quality === "4k" ? "4K HDR" : "VR SEAT"}</span>}
          {t.status === "paid" && t.createdAt && Date.parse(t.createdAt) < start - CANCEL_UNTIL && <span className="b white">PRE-ORDERED</span>}
          {t.movedFrom && !past && <span className="b warn">NEW DATE</span>}
          {s.adult && <span className="b out">18+</span>}
        </div>
      </div>
      <div className="tk-actions">
        {t.status === "paid" && <Link href={`/receipts/${t.holdId}`} className="state-btn ghost">Receipt</Link>}
        {t.status === "paid" && !past && (start - now > CANCEL_UNTIL || (t.refundUntil && Date.parse(t.refundUntil) > now && start > now)) && (
          <CancelSeat holdId={t.holdId} film={s.film} until={new Date(t.refundUntil && Date.parse(t.refundUntil) > start - CANCEL_UNTIL ? Date.parse(t.refundUntil) : start - CANCEL_UNTIL).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" })} />
        )}
        {t.status === "held" ? <Link href={`/checkout?film=${s.id}`} className="state-btn primary">Finish payment</Link>
          : past ? null
          : open ? <Link href={`/room/${s.id}`} className="state-btn primary">Join room</Link>
          : <a href={`/api/calendar/${s.id}.ics`} className="state-btn">Add to calendar</a>}
      </div>
    </article>
  );
}

function GiftRow({ g, now }: { g: Gift; now: number }) {
  const s = g.showtimeId ? findShowtime(g.showtimeId) : undefined;
  const p = s?.poster ?? { from: "#3a0d12", via: "#1b1b21", to: "#0a0a0c", glow: "rgba(227,24,45,.4)" };
  const due = Date.parse(g.deliverAt);
  return (
    <article className="tk-row">
      <div className="tk-poster" style={{ background: `linear-gradient(180deg, ${p.from}, ${p.via} 60%, ${p.to})` }} aria-hidden>
        <i style={{ background: `radial-gradient(circle, ${p.glow}, transparent 70%)` }} />
        <span>GIFT</span>
      </div>
      <div className="tk-info">
        <h2>{(s?.film ?? describeGift(g)).toUpperCase()}</h2>
        <p>For {g.name} · {g.email || g.phone}</p>
        <div className="tk-badges">
          {g.status === "pending" ? <span className="b warn">PAYMENT PENDING</span>
            : g.status === "redeemed" ? <span className="b white">CLAIMED</span>
            : g.deliveredAt ? <span className="b out">DELIVERED</span>
            : <span className="b out">ARRIVES {new Date(due).toLocaleDateString("en-GB", { day: "numeric", month: "short" }).toUpperCase()}{due - now < 86_400_000 ? ` ${new Date(due).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}` : ""}</span>}
          <span className="b out">${(g.amountCents / 100).toFixed(2)}</span>
        </div>
      </div>
      <div className="tk-actions">
        {g.status !== "pending" && g.code && g.status !== "redeemed" && <Link href={`/gift/redeem/${g.code}`} className="state-btn ghost">Gift link</Link>}
        <Link href="/gift" className="state-btn">Send another</Link>
      </div>
    </article>
  );
}
