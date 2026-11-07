import Link from "next/link";
import { dubName, type Dub } from "@/lib/dub-types";
import { MARKETS, type Premiere } from "@/lib/premiere-types";
import type { PremierePlan, Sales, Upload } from "@/lib/studio-types";

// The Languages, Rights and Pre-sales tabs of "Studio / Film detail" (Figma 99:247).
// Everything here is read from the film's own records; nothing is estimated.

const n = (v: number) => v.toLocaleString("en-GB");
const usd = (cents: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(cents / 100);
const dayLabel = (d: string) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${d}T00:00:00Z`));
const country = (code: string) => MARKETS.find((m) => m.country === code)?.name ?? (code === "??" ? "Country not given" : code);
function local(cur: string, minor: number) {
  const m = MARKETS.find((x) => x.currency === cur);
  const digits = m?.digits ?? 2;
  const v = (minor / 10 ** digits).toLocaleString("en-GB", { minimumFractionDigits: 0, maximumFractionDigits: digits });
  return `${m?.symbol ?? `${cur} `}${v}`;
}

const DUB_PILL: Record<Dub["status"], [string, string]> = {
  translating: ["grey", "Translating"], review: ["amber", "To review"], voicing: ["grey", "Voicing"], approved: ["teal", "Approved"], failed: ["red", "Failed"],
};

export function LanguagesTab({ upload: u, dubs, canEdit }: { upload: Upload; dubs: Dub[] | null; canEdit: boolean }) {
  const subs = u.files.filter((f) => f.kind === "subtitles");
  return (
    <div className="stfd-two">
      <div className="stfd-col">
        <section className="bp-panel">
          <h2>Original language</h2>
          <div className="stfd-v">
            <div><b>{u.languages || "Not set"}</b><small>{u.languages ? "What the film is spoken in, as viewers read it" : "Add it in Details so viewers know what they are booking"}</small></div>
            {!u.languages && canEdit && <Link className="vf-btn sm sec" href={`/studio/films/${u.id}`}>Add</Link>}
          </div>
        </section>
        <section className="bp-panel">
          <h2>Subtitles</h2>
          {subs.length === 0 && <p className="pt-hint">No subtitle files yet. Upload SRT, VTT or TTML files, or let AI write them from the dialogue.</p>}
          {subs.map((f) => {
            const warn = f.checks.filter((c) => c.state === "warn").length + (f.status === "failed" ? 1 : 0);
            const [lang, lines] = f.info.split(" · ");
            return (
              <div key={f.id} className="stfd-v">
                <div><b>{f.status === "uploaded" && lang ? lang.replace(/ subtitles$/, "") : f.name}</b><small>{f.status === "uploading" ? "Still uploading" : f.status === "failed" ? "Could not be read. Upload it again" : [lines, f.name].filter(Boolean).join(" · ")}</small></div>
                <span className={`stfd-pill ${f.status === "uploading" ? "grey" : warn ? "amber" : "teal"}`}>{f.status === "uploading" ? "Uploading" : warn ? `Fix ${warn}` : "Passed"}</span>
              </div>
            );
          })}
          {canEdit && <Link className="vf-btn sm sec stfd-act" href={`/studio/upload/${u.id}`}>Upload subtitles</Link>}
        </section>
      </div>
      <div className="stfd-col">
        <section className="bp-panel">
          <h2>Dubbed audio</h2>
          {dubs === null && <p className="vf-err" role="alert">Dubs could not be loaded. Refresh to try again.</p>}
          {dubs?.length === 0 && <p className="pt-hint">No dubs yet. AI translates the dialogue, you review every line, then it is voiced.</p>}
          {dubs?.map((d) => (
            <Link key={d.lang} className="stfd-v stfd-link" href={`/studio/dubs?film=${u.id}&lang=${d.lang}`}>
              <div><b>{dubName(d.lang)}</b><small>{[`${n(d.lines)} ${d.lines === 1 ? "line" : "lines"}`, d.flagged ? `${n(d.flagged)} flagged` : "", d.status === "voicing" ? `${n(d.voiced)} voiced` : "", d.error].filter(Boolean).join(" · ")}</small></div>
              <span className={`stfd-pill ${DUB_PILL[d.status][0]}`}>{DUB_PILL[d.status][1]}</span>
            </Link>
          ))}
          <Link className="vf-btn sm sec stfd-act" href={`/studio/dubs?film=${u.id}`}>{dubs?.length ? "Open AI dubbing" : "Start a dub"}</Link>
        </section>
      </div>
    </div>
  );
}

type Leak = { id: string; showtimeId: string; status: "open" | "takedown_sent" | "taken_down" | "allowed" };

export function RightsTab({ upload: u, plan, premiere, leaks, rightsDeclared }: { upload: Upload; plan: PremierePlan | null; premiere: Premiere | null; leaks: Leak[] | null; rightsDeclared: boolean }) {
  const mine = plan && leaks ? leaks.filter((l) => l.showtimeId === plan.showtimeId) : [];
  const open = mine.filter((l) => l.status === "open" || l.status === "takedown_sent").length;
  const down = mine.filter((l) => l.status === "taken_down").length;
  const prices = premiere?.prices ?? [];
  return (
    <div className="stfd-two">
      <div className="stfd-col">
        <section className="bp-panel">
          <h2>Rights</h2>
          <div className="stfd-v">
            <div><b>Rights declaration</b><small>{rightsDeclared ? "Your studio declared it holds the rights to show its films on E-Cinema" : "Declare your rights in studio setup before a premiere can go on sale"}</small></div>
            {rightsDeclared ? <span className="stfd-pill teal">Approved</span> : <Link className="vf-btn sm sec" href="/studio">Declare</Link>}
          </div>
          <div className="stfd-v">
            <div><b>Age rating</b><small>{u.ageRating ? "Shown on the film page. 18+ films can only be booked after the face and ID check" : "Not set. Add it in Details"}</small></div>
            <span className={`stfd-pill ${u.ageRating ? "teal" : "red"}`}>{u.ageRating || "Needed"}</span>
          </div>
          <div className="stfd-v">
            <div><b>Watermark</b><small>A code unique to each viewer is drawn into the picture of every room</small></div>
            <span className="stfd-pill teal">On</span>
          </div>
          <div className="stfd-v">
            <div><b>Leaks found</b><small>{!plan ? "Tracked once the premiere is booked" : leaks === null ? "Could not be loaded" : mine.length ? `${n(open)} open · ${n(down)} taken down` : "None reported for this film"}</small></div>
            <Link className="vf-btn sm sec" href="/studio/piracy">Piracy protection</Link>
          </div>
        </section>
      </div>
      <div className="stfd-col">
        <section className="bp-panel">
          <h2>Where it plays</h2>
          {!premiere?.showtimeId && !premiere?.priceCents ? <p className="pt-hint">Not priced yet. Set the countries and prices in Pricing.</p> : (
            <>
              <div className="stfd-v">
                <div><b>Every other country</b><small>Base price, paid in US dollars</small></div>
                <span className="stfd-num">{usd(premiere.priceCents)}</span>
              </div>
              {prices.map((p) => (
                <div key={p.country} className="stfd-v">
                  <div><b>{country(p.country)}</b><small>{[p.note, p.sold ? `${n(p.sold)} sold` : ""].filter(Boolean).join(" · ") || "Local price"}</small></div>
                  <span className="stfd-num">{local(p.currency, p.amountMinor)}</span>
                </div>
              ))}
            </>
          )}
          <Link className="vf-btn sm sec stfd-act" href={`/studio/premieres?film=${u.id}`}>Change prices</Link>
        </section>
      </div>
    </div>
  );
}

export function PreSalesTab({ plan, sales }: { plan: PremierePlan | null; sales: Sales | null }) {
  if (!plan || !sales) {
    return <section className="bp-panel"><h2>Pre-sales</h2><p className="pt-hint">Seats go on sale once the premiere is booked in Pricing. Sales by day and by country show here.</p></section>;
  }
  const top = Math.max(1, ...sales.days.map((d) => d.seats));
  const last14 = sales.days.reduce((a, d) => a + d.seats, 0);
  return (
    <div className="stfd-col">
      <section className="bp-panel">
        <h2>Pre-sales so far</h2>
        <div className="stfd-k">
          <div className="bp-kpi"><span>Seats sold</span><b>{n(sales.seats)}</b><em className="muted">{n(last14)} in the last 14 days</em></div>
          <div className="bp-kpi"><span>Gross</span><b>{usd(sales.grossCents)}</b><em className="muted">{plan.sharePct}% to you</em></div>
          <div className="bp-kpi"><span>Countries</span><b>{n(sales.countries.length)}</b><em className="muted">with at least one seat</em></div>
        </div>
      </section>
      <section className="bp-panel">
        <h2>Seats by day</h2>
        <div className="stfd-bars" role="img" aria-label={`Seats sold each day for the last 14 days, ${n(last14)} in all`}>
          {sales.days.map((d) => (
            <div key={d.day} className="stfd-bar" title={`${dayLabel(d.day)}: ${n(d.seats)} ${d.seats === 1 ? "seat" : "seats"}`}>
              <small>{d.seats ? n(d.seats) : ""}</small>
              <i style={{ height: `${Math.max(d.seats ? 4 : 1, (d.seats / top) * 100)}%` }} className={d.seats ? "" : "zero"} />
              <span>{dayLabel(d.day).split(" ")[0]}</span>
            </div>
          ))}
        </div>
        <small className="stfd-dlg-hint">{dayLabel(sales.days[0].day)} to {dayLabel(sales.days[sales.days.length - 1].day)}, in UTC days.</small>
      </section>
      <section className="bp-panel">
        <h2>By country</h2>
        {sales.countries.length === 0 ? <p className="pt-hint">No seats sold yet.</p> : (
          <table className="stfd-tbl">
            <thead><tr><th>Country</th><th>Seats</th><th>Gross</th><th>Share of seats</th></tr></thead>
            <tbody>
              {sales.countries.map((c) => (
                <tr key={c.country}>
                  <td>{country(c.country)}</td><td>{n(c.seats)}</td><td>{usd(c.grossCents)}</td>
                  <td><span className="stfd-share"><i style={{ width: `${(c.seats / Math.max(1, sales.seats)) * 100}%` }} /></span>{Math.round((c.seats / Math.max(1, sales.seats)) * 100)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
