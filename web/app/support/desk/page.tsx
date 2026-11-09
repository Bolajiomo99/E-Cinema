import Link from "next/link";
import { currentAccount } from "@/lib/auth";
import { isStaff } from "@/lib/store";
import Logo from "@/components/landing/Logo";
import RequestThread from "@/components/help/RequestThread";
import { desk, deskThread, topicLabel } from "@/lib/support";

export const metadata = { title: "Support desk · E-Cinema", robots: { index: false } };

const TABS = [["open", "Waiting"], ["answered", "Answered"], ["closed", "Solved"]] as const;
const ago = (iso: string) => {
  const m = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60_000));
  return m < 60 ? `${m} min` : m < 2880 ? `${Math.round(m / 60)} h` : `${Math.round(m / 1440)} days`;
};

// The support desk (gap list item 10): staff answer what people send from Help and the AI concierge.
// Waiting requests are listed oldest first, so nobody waits longest.
export default async function SupportDesk({ searchParams }: { searchParams: Promise<{ status?: string; id?: string }> }) {
  const me = await currentAccount();
  if (!me || !isStaff(me.email)) {
    return <main id="main" className="rq-page"><Logo /><h1>Support desk</h1><p className="rq-note">This desk is for E-Cinema staff. <Link href="/signin?next=/support/desk">Sign in</Link></p></main>;
  }
  const sp = await searchParams;
  const status = TABS.some(([k]) => k === sp.status) ? sp.status! : "open";
  const id = /^\d{1,18}$/.test(sp.id ?? "") ? Number(sp.id) : 0;
  const [d, t] = await Promise.all([desk(status), id ? deskThread(id) : Promise.resolve(null)]);
  return (
    <main id="main" className="spd">
      <header className="spd-head">
        <Logo />
        <div>
          <h1>Support desk</h1>
          <p className="hc-sub">{d ? `${d.counts.open ?? 0} waiting${d.counts.open ? ` · oldest ${d.oldestMins < 60 ? `${d.oldestMins} min` : `${Math.round(d.oldestMins / 60)} h`}` : ""} · ${d.counts.answered ?? 0} answered · ${d.counts.closed ?? 0} solved` : "Could not load the desk."}</p>
        </div>
      </header>
      <nav className="spd-tabs" aria-label="Requests">
        {TABS.map(([k, label]) => <Link key={k} href={`/support/desk?status=${k}`} aria-current={k === status ? "page" : undefined}>{label}{d ? ` ${d.counts[k] ?? 0}` : ""}</Link>)}
      </nav>
      <div className="spd-grid">
        <ul className="rq-mine spd-list">
          {d && d.requests.length === 0 && <li className="rq-note">Nothing here.</li>}
          {d?.requests.map((r) => (
            <li key={r.id} className={r.id === id ? "on" : ""}>
              <Link href={`/support/desk?status=${status}&id=${r.id}`}>
                <span className="rq-top"><b translate="no">{r.subject}</b><small>{ago(r.updatedAt)}</small></span>
                <small>#{r.id} · {topicLabel(r.topic)} · <span translate="no">{r.email}</span>{r.via === "concierge" ? " · from AI" : ""}</small>
                <small translate="no">{r.lastStaff ? "Us: " : ""}{r.last}</small>
              </Link>
            </li>
          ))}
        </ul>
        <section className="spd-thread" aria-label="Conversation">
          {!t ? <p className="rq-note">Pick a request to read and answer it.</p> : (
            <>
              <header>
                <p className="lp-eyebrow">#{t.id} · {topicLabel(t.topic).toUpperCase()} · {t.member ? "MEMBER" : "GUEST"}{t.lang && t.lang !== "en" ? ` · WRITES IN ${t.lang.toUpperCase()}` : ""}</p>
                <h2 translate="no">{t.subject}</h2>
                <p className="hc-sub" translate="no">{t.name ? `${t.name} · ` : ""}{t.email}{t.assignee ? ` · answered by ${t.assignee}` : ""}</p>
              </header>
              <RequestThread messages={t.messages ?? []} post={`/api/support/desk/${t.id}`} label="Write your answer. It is emailed in their language with a link to reply." staffView closeable={t.status !== "closed"} />
            </>
          )}
        </section>
      </div>
    </main>
  );
}
