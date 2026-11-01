import { cookies } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import TopNav from "@/components/dash/TopNav";
import { DashShell } from "@/components/dash/DashShell";
import ApplyForm from "@/components/careers/ApplyForm";
import LandingFooter from "@/components/landing/LandingFooter";
import { accountApi, currentAccount, SESSION_COOKIE } from "@/lib/auth";
import { job } from "@/lib/careers";
import { KIND, type Application } from "@/lib/careers-types";
import { countryOptions, nameOf } from "@/lib/countries";
import { readLocale } from "@/lib/locale";

// Figma "Web / Careers · Job detail and apply" (114:1397).
export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const j = await job((await params).slug);
  return { title: j ? `${j.title} · E-Cinema careers` : "Role not found · E-Cinema" };
}

export default async function JobPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const [j, me, loc] = await Promise.all([job(slug), currentAccount(), readLocale()]);
  if (!j) notFound();
  let applied: Application | null = null;
  if (me) {
    const s = (await cookies()).get(SESSION_COOKIE)?.value;
    const r = await accountApi("GET", `/v1/me/jobs/${slug}`, undefined, s);
    if (r.status === 200) applied = (r.body as { application: Application | null }).application;
  }
  const place = j.remote ? (j.city.toLowerCase() === "remote" ? "REMOTE" : `${j.city.toUpperCase()} OR REMOTE`) : `${j.city.toUpperCase()}, ${nameOf(j.country).toUpperCase()}`;
  const body = (
    <div className="lp cpg">
      <TopNav me={me} t={loc.t} country={loc.country} lang={loc.lang} />
      <main className="jd">
        <article className="jd-copy">
          <p className="cp-kicker">{j.team.toUpperCase()} · {place} · {KIND[j.kind].toUpperCase()}</p>
          <h1>{j.title}</h1>
          <div className="jd-tags">
            <span className={`cr-badge ${j.quota}`}>{j.quota === "ng" ? "Nigeria role" : "Open worldwide"}</span>
            {j.pay && <span className="jd-tag">{j.pay}</span>}
            {j.setup && <span className="jd-tag">{j.setup}</span>}
          </div>
          <h2>What you will do</h2>
          <p>{j.about}</p>
          <h2>What you bring</h2>
          <p>{j.bring}</p>
          <h2>How we hire</h2>
          <p>A short form, a 30-minute chat, a paid take-home task, then a meeting with the team. You hear back within 10 working days, every time.</p>
          {j.quota === "ng" && <p className="jd-note">Nigeria roles are open to Nigerian citizens and residents anywhere, and to people already living in Nigeria.</p>}
          <p className="cp-fine"><Link href="/careers/jobs">All open roles</Link></p>
        </article>
        <aside className="jd-apply" id="apply">
          <h2>Apply</h2>
          {!j.open ? <p className="rf-note">This role is no longer open. <Link href="/careers/jobs">See open roles</Link></p>
            : !me ? <><p className="jd-muted">Sign in or create a free account so you can follow your application.</p><Link className="vf-btn red" href={`/signin?next=${encodeURIComponent(`/careers/jobs/${slug}#apply`)}`}>Sign in to apply</Link> <Link className="vf-btn ghost" href={`/join?next=${encodeURIComponent(`/careers/jobs/${slug}#apply`)}`}>Join free</Link></>
            : applied ? <p className="rf-note ok">You applied on {new Date(applied.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}. <Link href="/careers/applications">Track it in My applications</Link></p>
            : <ApplyForm slug={j.slug} quota={j.quota} name={me.name} email={me.email} country={loc.country ?? ""} countries={countryOptions()} />}
        </aside>
      </main>
      <LandingFooter />
    </div>
  );
  return me ? <DashShell>{body}</DashShell> : body;
}
