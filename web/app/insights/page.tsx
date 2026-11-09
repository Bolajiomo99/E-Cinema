import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { DashShell, SidebarToggle } from "@/components/dash/DashShell";
import AiNoticed from "@/components/insights/AiNoticed";
import PrintButton from "@/components/insights/PrintButton";
import { accountApi, currentAccount, SESSION_COOKIE } from "@/lib/auth";
import { genreShare, myInsights, type Range, type Totals } from "@/lib/insights";
import { trackLabel } from "@/lib/i18n";
import { countryName } from "@/lib/plans";

// Built from the Figma frame "Web / Insights" (19:462). Every number is the viewer's own.
export const dynamic = "force-dynamic";
export const metadata = { title: "Insights · E-Cinema" };

const RANGES: { id: Range; label: string }[] = [{ id: "month", label: "This month" }, { id: "6m", label: "6 months" }, { id: "all", label: "All time" }];
const COLORS = ["#e3182d", "#ff5a36", "#d4a03a", "#8b7cf6", "#2bb59a", "#4a90e2", "#c4c4cc"];
const hours = (s: number) => (s / 3600 >= 10 ? (s / 3600).toFixed(0) : (s / 3600).toFixed(1));
const money = (cur: string, cents: number) => new Intl.NumberFormat("en", { style: "currency", currency: cur, maximumFractionDigits: cents % 100 ? 2 : 0 }).format(cents / 100);
const flag = (cc: string) => (/^[A-Z]{2}$/.test(cc) ? String.fromCodePoint(...[...cc].map((c) => 0x1f1a5 + c.charCodeAt(0))) : "");

function Delta({ now, before, unit, range }: { now: number; before: number; unit?: string; range: Range }) {
  if (range === "all") return <span className="in-delta flat">Since you joined</span>;
  const vs = range === "month" ? "vs last month" : "vs the 6 months before";
  if (!before) return <span className="in-delta flat">{now ? `New ${vs.replace("vs ", "since ")}` : "Nothing yet"}</span>;
  const pct = Math.round(((now - before) / before) * 100);
  return <span className={`in-delta ${pct >= 0 ? "up" : "down"}`}>{pct >= 0 ? "▲" : "▼"} {Math.abs(pct)}%{unit ? ` ${unit}` : ""} {vs}</span>;
}

export default async function InsightsPage({ searchParams }: { searchParams: Promise<{ range?: string }> }) {
  const me = await currentAccount();
  if (!me) redirect("/signin?next=/insights");
  const session = (await cookies()).get(SESSION_COOKIE)?.value ?? "";
  const asked = (await searchParams).range;
  const range: Range = (["6m", "all"] as const).find((r) => r === asked) ?? "month";
  const [rep, prof] = await Promise.all([myInsights(session, range), accountApi("GET", "/v1/me/profile", undefined, session).catch(() => null)]);
  const plan = prof?.status === 200 ? ((prof.body as { plan?: string }).plan ?? "free") : "free";
  const now = new Date();
  const label = range === "month" ? now.toLocaleDateString("en-GB", { month: "long", year: "numeric" }) : range === "6m" ? "The last 6 months" : "Since you joined";
  const empty: Totals = { seconds: 0, premieres: 0, messages: 0, countries: 0, spent: {} };
  const cur = rep?.current ?? empty, prev = rep?.previous ?? empty;
  const spentCur = Object.keys(cur.spent)[0] ?? Object.keys(prev.spent)[0] ?? "USD";
  const months = rep?.months ?? [];
  const maxM = Math.max(1, ...months.map((m) => m.seconds));
  const genres = genreShare(rep?.films ?? []).slice(0, 5);
  const langTotal = (rep?.languages ?? []).reduce((n, l) => n + l.seconds, 0) || 1;
  const chats = rep?.chats ?? [];

  return (
    <DashShell defaultOpen>
      <main id="main" className="tk in">
        <div className="tk-head">
          <div>
            <div className="tk-title"><SidebarToggle /><h1>Your insights</h1></div>
            <p>{label} · updated after every screening</p>
          </div>
          <div className="tk-chips in-ranges">
            {RANGES.map((r) => <Link key={r.id} href={r.id === "month" ? "/insights" : `/insights?range=${r.id}`} className={r.id === range ? "on" : ""} aria-current={r.id === range ? "page" : undefined}>{r.label}</Link>)}
            <PrintButton />
          </div>
        </div>

        <section className="in-stats">
          <div><span>Hours watched</span><strong>{hours(cur.seconds)}</strong><Delta now={cur.seconds} before={prev.seconds} range={range} /></div>
          <div><span>Premieres attended</span><strong>{cur.premieres}</strong>
            {range === "all" ? <span className="in-delta flat">Since you joined</span> : cur.premieres === prev.premieres ? <span className="in-delta flat">{cur.premieres ? `Same as ${range === "month" ? "last month" : "before"}` : "Nothing yet"}</span> : <span className={`in-delta ${cur.premieres >= prev.premieres ? "up" : "down"}`}>{cur.premieres >= prev.premieres ? "▲" : "▼"} {Math.abs(cur.premieres - prev.premieres)} {cur.premieres >= prev.premieres ? "more" : "fewer"} than {range === "month" ? "last month" : "before"}</span>}
          </div>
          <div><span>Messages sent</span><strong>{cur.messages.toLocaleString()}</strong><Delta now={cur.messages} before={prev.messages} unit={cur.countries ? `· ${cur.countries} countr${cur.countries === 1 ? "y" : "ies"}` : ""} range={range} /></div>
          <div><span>Spent</span><strong>{money(spentCur, cur.spent[spentCur] ?? 0)}</strong>
            {range === "all" ? <span className="in-delta flat">Seats, kept films, gifts</span> : (() => {
              const d = (cur.spent[spentCur] ?? 0) - (prev.spent[spentCur] ?? 0);
              if (!d) return <span className="in-delta flat">{cur.spent[spentCur] ? `Same as ${range === "month" ? "last month" : "before"}` : "Nothing yet"}</span>;
              return <span className={`in-delta ${d <= 0 ? "up" : "down"}`}>{d <= 0 ? "▼" : "▲"} {money(spentCur, Math.abs(d))} vs {range === "month" ? "last month" : "before"}</span>;
            })()}
          </div>
        </section>

        <div className="in-grid">
          <section className="in-card in-bars">
            <div className="in-card-head"><h2>Hours watched</h2><span>Last 6 months</span></div>
            <div className="in-chart" role="img" aria-label={`Hours watched per month: ${months.map((m) => `${m.month} ${hours(m.seconds)} hours`).join(", ")}`}>
              {months.map((m, i) => (
                <div key={m.month} className="in-col">
                  <b>{m.seconds ? `${hours(m.seconds)}h` : ""}</b>
                  <span className={i === months.length - 1 ? "now" : ""} style={{ height: `${Math.max(2, (m.seconds / maxM) * 100)}%` }} />
                  <em>{new Date(`${m.month}-01T00:00:00Z`).toLocaleDateString("en-GB", { month: "short", timeZone: "UTC" })}</em>
                </div>
              ))}
            </div>
          </section>

          <section className="in-card">
            <div className="in-card-head"><h2>What you watch</h2></div>
            {genres.length ? (
              <>
                <div className="in-stack">{genres.map((g, i) => <span key={g.genre} style={{ width: `${g.share * 100}%`, background: COLORS[i] }} />)}</div>
                <ul className="in-legend">{genres.map((g, i) => <li key={g.genre}><i style={{ background: COLORS[i] }} />{g.genre}<b>{Math.round(g.share * 100)}%</b></li>)}</ul>
              </>
            ) : <p className="in-none">Your genres show here after your first screening.</p>}
          </section>

          <section className="in-card">
            <div className="in-card-head"><h2>Languages you watched in</h2></div>
            {rep?.languages.length ? (
              <ul className="in-langs">
                {rep.languages.slice(0, 4).map((l) => (
                  <li key={l.kind + l.lang}>
                    <div><span>{trackLabel(l.lang, l.kind)}</span><b>{Math.round((l.seconds / langTotal) * 100)}%</b></div>
                    <span className="in-meter"><i style={{ width: `${(l.seconds / langTotal) * 100}%` }} /></span>
                  </li>
                ))}
              </ul>
            ) : <p className="in-none">Watch with an AI dub or subtitles and your languages show here.</p>}
          </section>

          <section className="in-card">
            <div className="in-card-head"><h2>Who you chatted with</h2>{cur.countries > 0 && <span>{cur.countries} countr{cur.countries === 1 ? "y" : "ies"}</span>}</div>
            {chats.length ? (
              <ul className="in-chats">{chats.map((c) => <li key={c.country}><span>{flag(c.country)} {countryName(c.country)}</span><b>{c.messages.toLocaleString()} message{c.messages === 1 ? "" : "s"}</b></li>)}</ul>
            ) : <p className="in-none">Say hello in a watch room and the countries you talk with show here.</p>}
          </section>

          <AiNoticed range={range} paid={["pro", "vip", "enterprise"].includes(plan)} />
        </div>
      </main>
    </DashShell>
  );
}
