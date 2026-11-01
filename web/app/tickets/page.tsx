import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { DashShell, SidebarToggle } from "@/components/dash/DashShell";
import LocalWhen from "@/components/dash/LocalWhen";
import CancelSeat from "@/components/tickets/CancelSeat";
import { myTickets, type MyTicket } from "@/lib/api";
import { currentAccount, SESSION_COOKIE } from "@/lib/auth";
import { endsAt, findShowtime, type Showtime } from "@/lib/catalog";

// Built from the Figma frame "Web / My tickets" (31:605).
export const dynamic = "force-dynamic";
export const metadata = { title: "My tickets · E-Cinema" };

type Row = MyTicket & { show: Showtime };
const ROOM_OPENS = 30 * 60_000; // the room opens half an hour before the film
const CANCEL_UNTIL = 7 * 86_400_000; // free cancellation until 7 days before

export default async function Tickets({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const me = await currentAccount();
  if (!me) redirect("/signin?next=/tickets");
  const session = (await cookies()).get(SESSION_COOKIE)?.value;
  const view = (await searchParams).view === "past" ? "past" : "upcoming";
  const now = Date.now();
  const rows = (await myTickets(session).catch(() => []))
    .map((t) => ({ ...t, show: findShowtime(t.showtimeId) }))
    .filter((t): t is Row => Boolean(t.show));
  const upcoming = rows.filter((t) => endsAt(t.show) > now);
  const past = rows.filter((t) => endsAt(t.show) <= now && t.status === "paid").reverse();
  const list = view === "past" ? past : upcoming;

  return (
    <DashShell defaultOpen>
      <main className="tk">
        <div className="tk-head">
          <div>
            <div className="tk-title"><SidebarToggle /><h1>My tickets</h1></div>
            <p>Upcoming seats and past screenings</p>
          </div>
          <div className="tk-chips" role="tablist">
            <Link href="/tickets" role="tab" aria-selected={view === "upcoming"} className={view === "upcoming" ? "on" : ""}>Upcoming {upcoming.length}</Link>
            <Link href="/tickets?view=past" role="tab" aria-selected={view === "past"} className={view === "past" ? "on" : ""}>Past {past.length}</Link>
            <span className="soon" title="Gifting seats is coming soon" aria-disabled="true">Gifted 0</span>
          </div>
        </div>

        {list.length === 0 && (
          <div className="tk-empty">
            <h2>{view === "past" ? "No past screenings yet" : "No seats yet"}</h2>
            <p>{view === "past" ? "Films you have watched show up here after the credits." : "Every title screens once. Pick one and your seat shows up here."}</p>
            <Link href="/releases" className="state-btn primary">See what is on</Link>
          </div>
        )}

        {list.map((t) => <TicketRow key={t.holdId} t={t} now={now} past={view === "past"} />)}

        <div className="tk-note">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden><rect x="4.5" y="10.5" width="15" height="10" rx="2" /><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" /></svg>
          <p>Cancel free until 7 days before a screening and get a full refund to how you paid. If a premiere is cancelled you are refunded automatically. Gifting seats is coming soon.</p>
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
          {s.adult && <span className="b out">18+</span>}
        </div>
      </div>
      <div className="tk-actions">
        {t.status === "paid" && <Link href={`/receipts/${t.holdId}`} className="state-btn ghost">Receipt</Link>}
        {t.status === "paid" && !past && start - now > CANCEL_UNTIL && (
          <CancelSeat holdId={t.holdId} film={s.film} until={new Date(start - CANCEL_UNTIL).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" })} />
        )}
        {t.status === "held" ? <Link href={`/checkout?film=${s.id}`} className="state-btn primary">Finish payment</Link>
          : past ? null
          : open ? <Link href={`/room/${s.id}`} className="state-btn primary">Join room</Link>
          : <a href={`/api/calendar/${s.id}.ics`} className="state-btn">Add to calendar</a>}
      </div>
    </article>
  );
}
