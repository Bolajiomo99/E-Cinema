import Link from "next/link";
import CompanyLayout from "@/components/company/CompanyLayout";
import { jobBoard } from "@/lib/careers";
import { KIND, where } from "@/lib/careers-types";
import { countryOptions, nameOf } from "@/lib/countries";

// Figma "Web / Careers · Jobs board" (114:1273).
export const dynamic = "force-dynamic";
export const metadata = { title: "Open roles · E-Cinema careers" };

type SP = { q?: string; country?: string; team?: string; quota?: string; kind?: string; all?: string };
const PAGE = 20;

export default async function JobsBoard({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const clean = (v?: string, re = /^[\w\s,.-]{0,60}$/) => (v && re.test(v) ? v : undefined);
  const f = { q: clean(sp.q), country: clean(sp.country, /^[A-Z]{2}$/), team: clean(sp.team), quota: clean(sp.quota, /^(ng|world)$/), kind: clean(sp.kind, /^(remote|intern|part|full|shift)$/) };
  const b = await jobBoard(f);
  const shown = sp.all ? b.jobs : b.jobs.slice(0, PAGE);
  const link = (patch: Partial<SP>) => {
    const next = { ...f, ...patch } as Record<string, string | undefined>;
    const qs = new URLSearchParams(Object.entries(next).filter((e): e is [string, string] => Boolean(e[1]))).toString();
    return `/careers/jobs${qs ? `?${qs}` : ""}#roles`;
  };
  const chips: [string, Partial<SP>, number][] = [
    ["All", { quota: undefined, kind: undefined }, b.total],
    ["Nigeria only", { quota: "ng", kind: undefined }, b.nigeria],
    ["Open worldwide", { quota: "world", kind: undefined }, b.world],
    ["Remote", { kind: "remote", quota: undefined }, b.kinds.remote ?? 0],
    ["Internships", { kind: "intern", quota: undefined }, b.kinds.intern ?? 0],
    ["Part time", { kind: "part", quota: undefined }, b.kinds.part ?? 0],
  ];
  const on = (c: Partial<SP>) => (c.quota ?? undefined) === f.quota && (c.kind ?? undefined) === f.kind;
  const ngPct = b.total ? Math.round((b.nigeria / b.total) * 100) : 0;
  return (
    <CompanyLayout kicker={`CAREERS · ${b.total} OPEN ROLE${b.total === 1 ? "" : "S"}`} title="WORK ON THE CINEMA THE WHOLE WORLD WATCHES."
      lead={`Anyone in any country can apply. ${b.ngShare}% of our roles are kept for people in Nigeria, where E‑Cinema was born, and ${100 - b.ngShare}% are open to everyone else.`}
      actions={[["Search roles", "#roles"], ["How we hire", "#how"]]}>
      <section className="cp-sec" id="roles">
        <h2>Open roles</h2>
        <form className="cr-filters" action="/careers/jobs" method="get">
          <label className="cr-f cr-q"><span>Search</span><input name="q" defaultValue={f.q} placeholder="Engineer, designer, moderator…" maxLength={60} /></label>
          <label className="cr-f"><span>Country</span>
            <select name="country" defaultValue={f.country ?? ""}><option value="">Any country</option>{countryOptions().map(([c, n]) => <option key={c} value={c}>{n}</option>)}</select>
          </label>
          <label className="cr-f"><span>Team</span>
            <select name="team" defaultValue={f.team ?? ""}><option value="">All teams</option>{(b.teams ?? []).map((t) => <option key={t} value={t}>{t}</option>)}</select>
          </label>
          {f.quota && <input type="hidden" name="quota" value={f.quota} />}
          {f.kind && <input type="hidden" name="kind" value={f.kind} />}
          <button className="vf-btn red" type="submit">Search</button>
        </form>
        <nav className="cr-chips" aria-label="Filter roles">
          {chips.map(([t, c, n]) => <Link key={t} href={link(c)} className={on(c) ? "on" : ""} aria-current={on(c) ? "true" : undefined}>{t} <em>{n}</em></Link>)}
        </nav>
        <div className="cr-share">
          <div className="cr-share-h"><b>How roles are shared</b><span>Set by the CEO · checked every hiring round</span></div>
          <div className="cr-bar" role="img" aria-label={`Target ${b.ngShare}% Nigeria; today ${ngPct}% of open roles`}>
            <i style={{ width: `${b.ngShare}%` }}>Nigeria {b.ngShare}%</i><i>Rest of the world {100 - b.ngShare}%</i>
          </div>
          {b.total > 0 && <small>Today {b.nigeria} of {b.total} open roles ({ngPct}%) are kept for Nigeria.</small>}
        </div>
        {shown.length === 0 && <div className="cr-empty"><b>No roles match.</b><p>{b.total ? <>Try fewer filters or <Link href="/careers/jobs#roles">see every role</Link>.</> : "We post every new role here first. Check back soon."}</p></div>}
        <ul className="cr-list">
          {shown.map((j) => (
            <li key={j.slug}>
              <div><b>{j.title}</b><small>{j.team} · {where(j, nameOf)} · {KIND[j.kind]}</small></div>
              <span className={`cr-badge ${j.quota}`}>{j.quota === "ng" ? "Nigeria role" : "Open worldwide"}</span>
              <Link className="vf-btn ghost" href={`/careers/jobs/${j.slug}`}>View and apply</Link>
            </li>
          ))}
        </ul>
        {!sp.all && b.jobs.length > PAGE && <Link className="cr-more" href={`${link({}).replace("#roles", "")}${link({}).includes("?") ? "&" : "?"}all=1#roles`}>Show {b.jobs.length - PAGE} more</Link>}
      </section>
      <section className="cp-sec" id="how">
        <h2>How we hire</h2>
        <p className="cp-p">A short form, a 30-minute chat, a paid take-home task, then a meeting with the team. You hear back within 10 working days, every time. A person reads every application; AI only helps sort, never rejects.</p>
      </section>
    </CompanyLayout>
  );
}
