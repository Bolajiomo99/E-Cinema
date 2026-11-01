import Link from "next/link";
import { notFound } from "next/navigation";
import TopNav from "@/components/dash/TopNav";
import { DashShell } from "@/components/dash/DashShell";
import LocalWhen from "@/components/dash/LocalWhen";
import TrailerButton from "@/components/landing/TrailerButton";
import ChooseHow, { type Option } from "@/components/preorder/ChooseHow";
import { currentAccount } from "@/lib/auth";
import { findShowtime } from "@/lib/catalog";
import { readLocale } from "@/lib/locale";
import { priceStages, qualitiesFor, quote } from "@/lib/ticket-quote";

// Built from the Figma frame "Web / Pre-order" (52:958).
export const dynamic = "force-dynamic";

const money = (cur: string, v: string) => (cur === "USD" ? `$${v}` : `${cur} ${v}`);
const day = (t: number) => new Date(t).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const s = findShowtime((await params).id);
  return { title: s ? `Pre-order ${s.film} · E-Cinema` : "Pre-order · E-Cinema" };
}

export default async function PreorderPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ q?: string }> }) {
  const [{ id }, sp, me, loc] = await Promise.all([params, searchParams, currentAccount(), readLocale()]);
  const s = findShowtime(id);
  if (!s) notFound();
  const now = Date.now();
  const start = Date.parse(s.startsAt);
  const open = start > now;
  const preorder = quote(s, undefined, now).preorderSave > 0;

  const options: Option[] = qualitiesFor(s).map((x) => {
    const q = quote(s, undefined, now, x.id);
    const stages = priceStages(s, x.id, now);
    return {
      id: x.id, name: x.name, sub: x.sub, price: money(q.currency, q.seat),
      stages: stages.map((st, i) => ({ label: st.label, price: money(st.currency, st.seat), until: i === stages.length - 1 && stages.length > 1 ? day(start) : `until ${day(st.until)}` })),
    };
  });
  const langs = [s.language, ...(s.language === "English" ? ["Yorùbá", "Hausa"] : ["English"])].filter(Boolean).slice(0, 3).join(", ");
  const dubs = Math.max(0, (s.dubs ?? 3) - 2);

  const body = (
    <div className="lp po">
      <TopNav me={me} active="coming" t={loc.t} country={loc.country} lang={loc.lang} />
      <main className="po-row">
        <section className="po-l">
          <TrailerButton film={s.id} title={s.film} className="po-trailer" ariaLabel={`Play the ${s.film} trailer`}>
            <span className="po-trailer-bg" style={{ background: `linear-gradient(180deg, ${s.poster?.from ?? "#2b2f36"} 0%, ${s.poster?.via ?? "#111317"} 60%, #000 100%)` }} aria-hidden />
            <span className="po-glow" style={{ background: `radial-gradient(closest-side, ${s.poster?.glow ?? "rgba(227,24,45,.45)"}, transparent)` }} aria-hidden />
            <span className="po-play" aria-hidden><svg viewBox="0 0 28 28"><path d="M10 7.5v13l10-6.5z" fill="none" stroke="#fff" strokeWidth="2" strokeLinejoin="round" /></svg></span>
            <span className="po-tr-note">Official trailer · {s.dubs ?? 3} languages</span>
          </TrailerButton>
          <h1>{s.film.toUpperCase()}</h1>
          <p className="po-blurb">{s.blurb ?? `${s.film} premieres once, worldwide at the same moment, with live AI dubs and a shared chat.`}</p>
          <div className="br-chips">
            <span className="br-chip on">Releases&nbsp;<LocalWhen iso={s.startsAt} suffix=" your time" /></span>
            <span className="br-chip">{[(s.genres ?? [])[0], s.rating].filter(Boolean).join(" · ")}</span>
            <span className="br-chip">{s.studio}</span>
            <span className="br-chip">{langs}{dubs ? ` + ${dubs}` : ""}</span>
          </div>
        </section>
        {open ? (
          <ChooseHow
            film={s.id}
            options={options}
            initial={sp.q ?? (options.find((o) => o.id === "4k") ? "4k" : "hd")}
            cta={preorder ? "Pre-order" : "Get a seat"}
            perks={[
              { text: "Guaranteed seat even if it sells out" },
              { text: "Bring friends: party of up to 8 keeps the early price", soon: true },
              { text: "Free cancellation until 7 days before" },
              { text: "Pre-order badge and early clips in your feed", soon: true },
            ]}
          />
        ) : (
          <div className="po-r">
            <h2>Pre-orders have closed</h2>
            <p className="po-blurb">This premiere has started. <Link href={`/film/${s.id}`}>See the film page</Link> for late entry.</p>
          </div>
        )}
      </main>
    </div>
  );
  return me ? <DashShell>{body}</DashShell> : body;
}
