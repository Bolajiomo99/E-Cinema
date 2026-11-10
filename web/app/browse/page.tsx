import Link from "next/link";
import TopNav from "@/components/dash/TopNav";
import { DashShell } from "@/components/dash/DashShell";
import PosterCard from "@/components/browse/PosterCard";
import { currentAccount } from "@/lib/auth";
import { TYPES, filterShowtimes, languages, typeOf, type TypeId, type When } from "@/lib/browse";
import { langName } from "@/lib/i18n";
import { readLocale } from "@/lib/locale";
import { withLocalPrices } from "@/lib/seat-price";

// Built from the Figma frame "Web / Browse by type" (30:564), with the real catalogue.
export const dynamic = "force-dynamic";
export const metadata = { title: "Browse · E-Cinema" };

type Q = { type?: string; when?: string; lang?: string; dub?: string };

export default async function BrowsePage({ searchParams }: { searchParams: Promise<Q> }) {
  const [q, me, loc] = await Promise.all([searchParams, currentAccount(), readLocale()]);
  const when: When | undefined = q.when === "next" ? "next" : q.when === "all" ? undefined : "week";
  const type = TYPES.find((x) => x.id === q.type)?.id as TypeId | undefined;
  const lang = languages().includes(q.lang ?? "") ? q.lang : undefined;
  const myLang = langName(loc.lang);
  const dub = q.dub === "1";

  let list = filterShowtimes({ when, lang });
  // "Dubbed in <my language>": titles whose original audio is another language, which we dub live.
  if (dub) list = list.filter((s) => s.language !== myLang);
  list = await withLocalPrices(list, loc.country);
  const counts = new Map<TypeId, number>();
  for (const s of filterShowtimes({ when: undefined })) counts.set(typeOf(s), (counts.get(typeOf(s)) ?? 0) + 1);

  const href = (patch: Partial<Q>) => {
    const next = { type, when: q.when, lang, dub: dub ? "1" : undefined, ...patch };
    const sp = new URLSearchParams(Object.entries(next).filter(([, v]) => v) as [string, string][]);
    const s = sp.toString();
    return s ? `/browse?${s}` : "/browse";
  };
  const rows = (type ? TYPES.filter((x) => x.id === type) : TYPES)
    .map((t) => ({ t, films: list.filter((s) => typeOf(s) === t.id) }))
    .filter((r) => type || r.films.length);

  const body = (
    <div className="lp br">
      <TopNav me={me} active="home" t={loc.t} country={loc.country} lang={loc.lang} />
      <main id="main" className="br-body">
        <header className="br-head">
          <div>
            <h1>{type ? TYPES.find((x) => x.id === type)!.label : "Browse"}</h1>
            <p>Every format, only new releases. Each premiere screens on its date, then leaves.</p>
          </div>
          <div className="br-chips" role="group" aria-label="Filters">
            <Link href={href({ when: undefined })} className={`br-chip${when === "week" ? " on" : ""}`}>This week</Link>
            <Link href={href({ when: "next" })} className={`br-chip${when === "next" ? " on" : ""}`}>Next week</Link>
            <Link href={href({ when: "all" })} className={`br-chip${when === undefined ? " on" : ""}`}>Any date</Link>
            <details className="br-menu">
              <summary className={`br-chip${lang ? " on" : ""}`}>{lang ? `${lang} audio` : "Any language"}</summary>
              <div className="br-pop">
                <Link href={href({ lang: undefined })}>Any language</Link>
                {languages().map((l) => <Link key={l} href={href({ lang: l })} className={l === lang ? "on" : undefined}>{l}</Link>)}
              </div>
            </details>
            <Link href={href({ dub: dub ? undefined : "1" })} className={`br-chip${dub ? " on" : ""}`} title={`Films made in another language, dubbed live into ${myLang} by AI`}>Dubbed in {myLang}</Link>
          </div>
        </header>

        <nav className="br-types" aria-label="Formats">
          {TYPES.map((t) => (
            <Link key={t.id} href={type === t.id ? href({ type: undefined }) : href({ type: t.id })} className={`br-type${type === t.id ? " on" : ""}`} style={{ background: `linear-gradient(90deg, ${t.from} 0%, ${t.via} 58%, #000 100%)` }} aria-current={type === t.id ? "page" : undefined}>
              <span className="br-type-glow" style={{ background: t.glow }} aria-hidden />
              <span className="br-type-n">{counts.get(t.id) ? `${counts.get(t.id)} premiere${counts.get(t.id) === 1 ? "" : "s"}` : "Soon"}</span>
              <span className="br-type-l">{t.label.toUpperCase()}</span>
            </Link>
          ))}
        </nav>

        {rows.length === 0 && (
          <div className="br-empty">
            <strong>No premieres match these filters</strong>
            <p>Try another week or language. New titles are added every week.</p>
            <Link href="/browse" className="lp-btn sm secondary">Clear filters</Link>
          </div>
        )}
        {rows.map(({ t, films }) => (
          <section key={t.id} className="hm-row br-row" aria-label={t.label}>
            <div className="hm-row-head">
              <div>
                <h2>{t.id === "movies" ? "Movie premieres" : `${t.label} premieres`}</h2>
                <p>{t.sub}</p>
              </div>
              {!type && <Link href={href({ type: t.id })}>See all</Link>}
            </div>
            {films.length ? (
              <div className="br-grid">{films.map((s) => <PosterCard key={s.id} s={s} />)}</div>
            ) : (
              <div className="br-empty">
                <strong>No {t.label.toLowerCase()} premieres {when === "next" ? "next week" : when === "week" ? "this week" : "scheduled"} yet</strong>
                <p>Studios add new titles every week. <Link href="/releases">See what&apos;s coming soon</Link> or <Link href={href({ type: undefined })}>browse every format</Link>.</p>
              </div>
            )}
          </section>
        ))}
      </main>
    </div>
  );
  return me ? <DashShell>{body}</DashShell> : body;
}
