import type { ReactNode } from "react";
import Link from "next/link";
import TopNav from "@/components/dash/TopNav";
import { DashShell } from "@/components/dash/DashShell";
import LandingFooter from "@/components/landing/LandingFooter";
import { currentAccount } from "@/lib/auth";
import { readLocale } from "@/lib/locale";

// The legal pages (Figma 89:1091 and 92:841 to 92:1350): a contents list on the left and a
// plain-language summary on the right.
export const LEGAL: [string, string][] = [
  ["Terms of use", "/terms"],
  ["Privacy policy", "/privacy"],
  ["Cookies", "/cookies"],
  ["Refunds", "/refunds"],
  ["Kids and family", "/legal/kids"],
  ["Studio terms", "/legal/studios"],
  ["Community rules", "/legal/community"],
];
export const UPDATED = "updated 14 October 2026";

export default async function LegalLayout({ here, title, lead, children, after }: { here: string; title: string; lead: string; children: ReactNode; after?: ReactNode }) {
  const [me, loc] = await Promise.all([currentAccount(), readLocale()]);
  const body = (
    <div className="lp lg">
      <TopNav me={me} t={loc.t} country={loc.country} lang={loc.lang} />
      <div className="lg-body">
        <nav className="lg-toc" aria-label="Legal">
          <b>Legal</b>
          {LEGAL.map(([t, href]) => <Link key={href} href={href} className={href === here ? "on" : ""} aria-current={href === here ? "page" : undefined}>{t}</Link>)}
        </nav>
        <main className="lg-doc">
          <h1>{title}</h1>
          <p className="lg-lead">{lead}</p>
          {children}
        </main>
      </div>
      {after}
      <LandingFooter />
    </div>
  );
  return me ? <DashShell>{body}</DashShell> : body;
}

export function Sections({ items }: { items: [string, string][] }) {
  return <>{items.map(([h, p]) => <section key={h} className="lg-sec"><h2>{h}</h2><p>{p}</p></section>)}</>;
}

export function Table({ head, rows }: { head: [string, string] | [string, string, string]; rows: string[][] }) {
  return (
    <table className="lg-table">
      <thead><tr>{head.map((h) => <th key={h}>{h}</th>)}</tr></thead>
      <tbody>{rows.map((r) => <tr key={r[0]}>{r.map((c, i) => <td key={i}>{c}</td>)}</tr>)}</tbody>
    </table>
  );
}
