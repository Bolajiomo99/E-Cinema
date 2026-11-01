import Link from "next/link";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import Logo from "@/components/landing/Logo";
import ShareButtons from "@/components/dash/ShareButtons";
import WorldTimes from "@/components/dash/WorldTimes";
import { myTickets } from "@/lib/api";
import { currentAccount, SESSION_COOKIE } from "@/lib/auth";
import { findShowtime } from "@/lib/catalog";

// Built from the Figma frame "Web / Payment success · ticket" (29:590).
export const dynamic = "force-dynamic";
export const metadata = { title: "You have a seat · E-Cinema" };

const ticketCode = (holdId: string) => `EC-${holdId.replace(/-/g, "").slice(0, 5).toUpperCase()}-${holdId.replace(/-/g, "").slice(-4).toUpperCase()}`;

export default async function Confirmed({ searchParams }: { searchParams: Promise<{ film?: string }> }) {
  const { film = "" } = await searchParams;
  const me = await currentAccount();
  if (!me) redirect(`/signin?next=/tickets/confirmed?film=${encodeURIComponent(film)}`);
  const show = findShowtime(film);
  if (!show) notFound();
  const session = (await cookies()).get(SESSION_COOKIE)?.value;
  const mine = (await myTickets(session).catch(() => [])).filter((t) => t.showtimeId === show.id && t.status === "paid");
  const t = mine.at(-1);
  if (!t) redirect("/tickets");
  const seats = mine.reduce((n, x) => n + x.seats, 0);
  const paid = (Number(show.price.value) * t.seats).toFixed(2);
  const words = show.film.toUpperCase().split(" ");
  const half = Math.ceil(words.length / 2);
  const p = show.poster ?? { from: "#1b1b21", via: "#0e0e12", to: "#000", glow: "transparent" };
  const url = `https://e-cinema.net/#premieres`;

  return (
    <main className="ok-page">
      <div className="ok-top"><Logo /></div>
      <span className="ok-check" aria-hidden>
        <svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
      </span>
      <h1>You have a seat</h1>
      <p className="ok-lead">We will remind you before the premiere. The room opens 30 minutes early.</p>
      <article className="ok-ticket">
        <div className="ok-poster" style={{ background: `linear-gradient(180deg, ${p.from}, ${p.via} 60%, ${p.to})` }} aria-hidden>
          <i style={{ background: `radial-gradient(circle, ${p.glow}, transparent 70%)` }} />
          <span>{words.slice(0, half).join(" ")}<br />{words.slice(half).join(" ")}</span>
        </div>
        <div className="ok-info">
          <div className="tk-badges">
            <span className="b white">SEAT CONFIRMED</span>
            <span className="b out">{seats} {seats === 1 ? "SEAT" : "SEATS"}</span>
          </div>
          <h2>{show.film.toUpperCase()}</h2>
          <div className="ok-grid">
            <div><p className="ok-k">Starts</p><WorldTimes iso={show.startsAt} /></div>
            <div><p className="ok-k">Audio · Subtitles</p><p className="ok-v">{show.language ?? "Original"} · {show.dubs ? `${show.dubs} AI dubs` : "English"}</p></div>
          </div>
          <div className="ok-grid">
            <div><p className="ok-k">Ticket</p><p className="ok-v">{ticketCode(t.holdId)}</p></div>
            <div><p className="ok-k">Paid</p><p className="ok-v">{show.price.currency === "USD" ? `$${paid}` : `${show.price.currency} ${paid}`} · PayPal</p></div>
          </div>
          <div className="ok-ctas">
            <a className="ok-btn" href={`/api/calendar/${show.id}.ics`}>Add to calendar</a>
            <ShareButtons url={url} film={show.film} when={new Date(show.startsAt).toUTCString().slice(0, 22) + " GMT"} />
          </div>
        </div>
      </article>
      <div className="ok-foot">
        <Link href={`/room/${show.id}`} className="ok-btn red">Go to the room lobby</Link>
        <Link href={`/receipts/${t.holdId}`} className="ok-link">Receipt</Link>
      </div>
    </main>
  );
}
