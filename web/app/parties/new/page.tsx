import Link from "next/link";
import { redirect } from "next/navigation";
import CreateParty from "@/components/parties/CreateParty";
import LocalWhen from "@/components/dash/LocalWhen";
import { accountApi, currentAccount, SESSION_COOKIE } from "@/lib/auth";
import { cookies } from "next/headers";
import type { RoomOption } from "@/lib/parties";
import { endsAt, findShowtime, showtimes } from "@/lib/catalog";

// Figma "Web / Create watch party" (31:934): a dialog over the film's colours.
export const dynamic = "force-dynamic";
export const metadata = { title: "Start a watch party · E-Cinema" };

export default async function NewParty({ searchParams }: { searchParams: Promise<{ film?: string }> }) {
  const { film } = await searchParams;
  const me = await currentAccount();
  if (!me) redirect(`/signin?next=${encodeURIComponent(`/parties/new${film ? `?film=${film}` : ""}`)}`);
  const open = showtimes.filter((s) => endsAt(s) > nowMs());
  const s = (film && findShowtime(film)) || open[0];
  if (!s || endsAt(s) < nowMs()) redirect("/home");
  const p = s.poster ?? { from: "#0c2a3a", via: "#06121a", to: "#000", glow: "rgba(70,150,255,.45)" };
  const first = me.name.split(" ")[0] || "My";
  const session = (await cookies()).get(SESSION_COOKIE)?.value;
  const rr = await accountApi("GET", "/v1/me/rooms?kinds=party,private", undefined, session).catch(() => null);
  const rooms = rr?.status === 200 ? (rr.body as RoomOption[]) : [];

  return (
    <main className="wp" style={{ background: `linear-gradient(90deg, ${p.from} 0%, ${p.via} 60%, #000 100%)` }}>
      <span className="wp-glow" style={{ background: `radial-gradient(circle, ${p.glow}, transparent 70%)` }} aria-hidden />
      <span className="wp-dim" aria-hidden />
      <section className="wp-modal" aria-labelledby="wp-title">
        <header className="wp-head">
          <h1 id="wp-title">Start a watch party</h1>
          <Link href="/home" className="wp-x" aria-label="Close">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden><path d="M6 6l12 12M18 6 6 18" /></svg>
          </Link>
        </header>
        <div className="wp-film">
          <span className="wp-poster" style={{ background: `linear-gradient(180deg, ${p.from} 0%, ${p.via} 60%, ${p.to} 100%)` }} />
          <div className="co-t">
            <strong>{s.film}</strong>
            <small><LocalWhen iso={s.startsAt} /> · ${s.price.value} a seat</small>
          </div>
          {open.length > 1 && (
            <form className="wp-switch" action="/parties/new">
              <select name="film" defaultValue={s.id} aria-label="Pick another premiere">
                {open.map((x) => <option key={x.id} value={x.id}>{x.film}</option>)}
              </select>
              <button type="submit">Switch</button>
            </form>
          )}
        </div>
        <CreateParty showtimeId={s.id} defaultName={`${first}'s party`} rooms={rooms} />
      </section>
    </main>
  );
}

function nowMs() {
  return Date.now();
}
