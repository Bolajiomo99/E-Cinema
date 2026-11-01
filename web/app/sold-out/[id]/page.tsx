import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import Logo from "@/components/landing/Logo";
import LocalePicker from "@/components/LocalePicker";
import DrawTime from "@/components/lottery/DrawTime";
import LotteryCard from "@/components/lottery/LotteryCard";
import { currentAccount, SESSION_COOKIE } from "@/lib/auth";
import { findShowtime } from "@/lib/catalog";
import { readLocale } from "@/lib/locale";
import { lottery, sweep } from "@/lib/lottery";

// Built from the Figma frame "Web / Sold out · free-seat lottery" (31:1121).
export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const s = findShowtime((await params).id);
  return { title: s ? `${s.film} is sold out · E-Cinema` : "Sold out · E-Cinema" };
}

const n = (x: number) => x.toLocaleString("en-US");
function took(min: number) {
  if (min < 60) return `${Math.max(1, min)} MINUTE${min === 1 ? "" : "S"}`;
  const h = Math.round(min / 60);
  if (h < 48) return `${h} HOUR${h === 1 ? "" : "S"}`;
  return `${Math.round(h / 24)} DAYS`;
}

export default async function SoldOut({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = findShowtime(id);
  if (!s) notFound();
  const [me, loc] = await Promise.all([currentAccount(), readLocale()]);
  const session = (await cookies()).get(SESSION_COOKIE)?.value;
  await sweep(s.id);
  const l = await lottery(s.id, session);
  if (!l || (!l.soldOut && !l.drawn)) redirect(`/checkout?film=${s.id}`);
  const odds = l.entries > l.freeSeats ? `1 in ${Math.ceil(l.entries / l.freeSeats)}` : l.entries ? "1 in 1" : "—";

  return (
    <main className="so">
      <div className="so-top">
        <Logo href={me ? "/home" : "/"} />
        <LocalePicker country={loc.country} lang={loc.lang} signedIn={Boolean(me)} />
      </div>
      <span className="so-badge"><i />SOLD OUT{l.soldOutAfterMin ? ` IN ${took(l.soldOutAfterMin)}` : ""}</span>
      <h1>{s.film.toUpperCase()}</h1>
      <p className="so-lead">{n(l.sold)} seats went{l.soldOutAfterMin ? ` in ${took(l.soldOutAfterMin).toLowerCase()}` : ""}, so {n(l.freeSeats)} free {l.freeSeats === 1 ? "seat opens" : "seats open"} by lottery.</p>
      <div className="so-stats">
        <div><b>{n(l.freeSeats)}</b><small>free seats</small></div>
        <div><b>{n(l.entries)}</b><small>people entered</small></div>
        <div><b>{odds}</b><small>{l.myEntry ? "your odds" : "the odds"}</small></div>
        <div><DrawTime iso={l.drawAt} /></div>
      </div>
      <LotteryCard l={l} showtimeId={s.id} signedIn={Boolean(me)} />
    </main>
  );
}
