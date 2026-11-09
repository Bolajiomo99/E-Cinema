import Link from "next/link";
import RevenuePanel from "@/components/studio/RevenuePanel";
import { nameOf } from "@/lib/countries";
import { change, money, when, type Film, type Overview } from "@/lib/studio-types";

// Figma "Studio / Overview" (34:274), from the studio's own numbers.
const POSTERS = ["#3d0f2e", "#0f3324", "#2b2f36", "#2a2108", "#0f1f3d"];
const SPARK = <svg viewBox="0 0 24 24" width="16" height="16" fill="#d4a23a" aria-hidden><path d="M12 2l1.8 6.2L20 10l-6.2 1.8L12 18l-1.8-6.2L4 10l6.2-1.8z" /></svg>;

export default function StudioOverview({ o, films, firstName }: { o: Overview; films: Film[]; firstName: string }) {
  const s = o.studio;
  const cur = o.currency;
  const hour = Number(new Date().toLocaleString("en-GB", { hour: "numeric", hour12: false, timeZone: "Africa/Lagos" }));
  const hello = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const today = new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "Africa/Lagos" });
  const earned = change(o.earnedMonth, o.earnedLast);
  const seats = change(o.seatsMonth, o.seatsLast);
  const studioShare = o.paidCents + o.owedCents;
  const platform = o.platformCents + (s.shareBps ? Math.round((o.owedCents * (10000 - s.shareBps)) / s.shareBps) : 0);
  const total = studioShare + platform;
  const pct = total ? (studioShare / total) * 100 : s.shareBps / 100;
  const payoutTo = s.payoutMethod === "paypal" && s.payoutEmail && !s.payoutEmail.startsWith("payouts+") ? `PayPal ${s.payoutEmail}` : "";
  return (
    <div className="pt-body">
      <header className="bp-head">
        <div>
          <h1>{hello}{firstName ? `, ${firstName}` : ""}</h1>
          <p>{s.name} · {today}</p>
        </div>
      </header>

      {o.live && (
        <div className="stu-live">
          <span className="stu-badge"><i />LIVE NOW</span>
          <div>
            <b>{o.live.film} premiere · {o.live.seats.toLocaleString("en-GB")} seats sold{o.live.countries ? ` in ${o.live.countries} ${o.live.countries === 1 ? "country" : "countries"}` : ""}</b>
            <small>Started {when(o.live.startsAt)} · {o.live.durationMin} min</small>
          </div>
          <Link className="vf-btn red" href="/studio/control">Open control room</Link>
        </div>
      )}

      <div className="bp-kpis stu-kpis">
        <div className="bp-kpi"><span>Earnings this month (your {s.shareBps / 100}%)</span><b>{money(o.earnedMonth, cur, true)}</b><em className={earned.up ? "" : "neg"}>{earned.text}</em></div>
        <div className="bp-kpi"><span>Tickets sold</span><b>{o.seatsMonth.toLocaleString("en-GB")}</b><em className={seats.up ? "" : "neg"}>{seats.text}</em></div>
        <div className="bp-kpi"><span>Countries reached</span><b>{o.countries}</b><em className={o.newCountries ? "" : "muted"}>{o.newCountries ? `▲ ${o.newCountries} new` : "no new ones this month"}</em></div>
        <div className="bp-kpi"><span>Avg completion</span><b>{Math.round(o.completion * 100)}%</b><em className="muted">of each film watched</em></div>
        <div className="bp-kpi"><span>Rating</span><b>{o.reviews ? `${o.rating.toFixed(1)} ★` : "–"}</b><em className={o.reviews ? "" : "muted"}>{o.reviews ? `from ${o.reviews.toLocaleString("en-GB")} ${o.reviews === 1 ? "review" : "reviews"}` : "no reviews yet"}</em></div>
      </div>

      <div className="pt-row a">
        <RevenuePanel months={o.months} films={films} countries={o.topCountries} currency={cur} />
        <section className="bp-panel">
          <h2>Coming up</h2>
          {o.coming.length ? o.coming.map((f, i) => (
            <div key={f.showtimeId} className="stu-up">
              <span className="stu-poster" style={{ background: `linear-gradient(180deg, ${POSTERS[i % POSTERS.length]}, #000)` }} aria-hidden />
              <div>
                <b>{f.film.toUpperCase()}</b>
                <small>{when(f.startsAt)}</small>
                <i className="stu-bar"><em style={{ width: `${f.capacity ? Math.min(100, (f.seats / f.capacity) * 100) : 0}%` }} /></i>
                <span>{f.seats.toLocaleString("en-GB")} / {f.capacity.toLocaleString("en-GB")} seats</span>
              </div>
            </div>
          )) : <p className="pt-empty">No premieres booked yet. <Link href="/studio/premieres">Book a premiere</Link> and it shows here.</p>}
        </section>
      </div>

      <div className="pt-row a">
        <section className="bp-panel">
          <h2>Studio AI noticed</h2>
          {o.notes.length ? o.notes.map((n) => (
            <div key={n.text} className="stu-note">{SPARK}<p>{n.text}</p></div>
          )) : <p className="pt-empty">Nothing needs you right now. Notes about seats, audiences and reviews appear here as your films sell.</p>}
          {o.topCountries.length > 0 && <p className="pt-hint">Top audiences: {o.topCountries.slice(0, 3).map((c) => nameOf(c.key)).join(", ")}</p>}
        </section>
        <section className="bp-panel stu-pay">
          <h2>Payout</h2>
          <b className="stu-big">{money(o.owedCents, cur)}</b>
          <small>{o.owedCents ? (payoutTo ? `Owed now · sent to ${payoutTo} as each premiere ends` : "Owed now · add a payout account in Settings") : payoutTo ? `Nothing owed · paid to ${payoutTo}` : "Nothing owed yet"}</small>
          <i className="stu-split" aria-hidden><em style={{ width: `${pct}%` }} /></i>
          <div className="stu-legend"><span>Studio {s.shareBps / 100}% · {money(studioShare, cur, true)}</span><span>E‑Cinema {100 - s.shareBps / 100}% · {money(platform, cur, true)}</span></div>
          <Link className="vf-btn wide" href="/studio/payouts">View statement</Link>
        </section>
      </div>
    </div>
  );
}
