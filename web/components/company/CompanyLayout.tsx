import type { ReactNode } from "react";
import Link from "next/link";
import TopNav from "@/components/dash/TopNav";
import { DashShell } from "@/components/dash/DashShell";
import LandingFooter from "@/components/landing/LandingFooter";
import { currentAccount } from "@/lib/auth";
import { readLocale } from "@/lib/locale";

// Company pages (Figma 94:947 About, 94:1055 For studios, 94:1157 Careers, 94:1239 For business):
// a red hero with a kicker, a big title and two buttons, then plain sections.
export default async function CompanyLayout({ kicker, title, lead, actions, children }: {
  kicker: string; title: string; lead: string; actions: [string, string][]; children: ReactNode;
}) {
  const [me, loc] = await Promise.all([currentAccount(), readLocale()]);
  const body = (
    <div className="lp cpg">
      <TopNav me={me} t={loc.t} country={loc.country} lang={loc.lang} />
      <header className="cp-hero">
        <div className="cp-copy">
          <p className="cp-kicker">{kicker}</p>
          <h1>{title}</h1>
          <p className="cp-lead">{lead}</p>
          <div className="cp-btns">
            {actions.map(([t, href], i) => href.startsWith("/")
              ? <Link key={t} className={`vf-btn ${i === 0 ? "red" : "ghost"}`} href={href}>{t}</Link>
              : <a key={t} className={`vf-btn ${i === 0 ? "red" : "ghost"}`} href={href}>{t}</a>)}
          </div>
        </div>
      </header>
      <main id="main" className="cp-main">{children}</main>
      <LandingFooter />
    </div>
  );
  return me ? <DashShell>{body}</DashShell> : body;
}

export function Section({ title, children, id }: { title: string; children: ReactNode; id?: string }) {
  return <section className="cp-sec" id={id}><h2>{title}</h2>{children}</section>;
}

export function Person({ initials, name, role, href }: { initials: string; name: string; role: string; href?: string }) {
  const inner = <><span className="cp-av" aria-hidden>{initials}</span><span><b>{name}</b><small>{role}</small></span></>;
  return href ? <Link className="cp-person" href={href}>{inner}</Link> : <div className="cp-person">{inner}</div>;
}
