import Link from "next/link";
import Logo from "@/components/landing/Logo";
import AccountMenu from "@/components/AccountMenu";
import LocalePicker from "@/components/LocalePicker";
import { SidebarToggle } from "@/components/dash/DashShell";
import type { dict } from "@/lib/i18n";

// The viewer top nav from the Figma discover frames (Browse 30:564, Search 30:750).
// Pages that are not built yet stay visible but marked "soon", never linked to a fake page.
type Me = { name: string; email: string } | null;

export default function TopNav({ me, active, t, country, lang }: { me: Me; active?: "home" | "coming" | "live" | "clips" | "community"; t: ReturnType<typeof dict>; country?: string; lang: string }) {
  const cls = (k: string) => (active === k ? "on" : undefined);
  return (
    <nav className="lp-nav hm-nav tn">
      <div className="lp-nav-left">
        <span className="dash-brand">{me && <SidebarToggle />}<Logo href={me ? "/home" : "/"} /></span>
        <div className="lp-nav-links">
          <Link href={me ? "/home" : "/"} className={cls("home")}>{t.home}</Link>
          <Link href="/coming-soon" className={cls("coming")}>{t.comingSoon}</Link>
          <Link href={me ? "/home#live" : "/#live"} className={cls("live")}>{t.live}</Link>
          {me ? <Link href="/community" className={cls("community")}>Community</Link> : <Link href="/signin?next=/community">Community</Link>}
          <Link href={me ? "/home#hm-clips" : "/browse"} className={cls("clips")}>Clips</Link>
          {["Shop", ...(me ? [] : ["Library"])].map((l) => (
            <span key={l} className="soon" title={`${l} is coming soon`} aria-disabled="true">{l}</span>
          ))}
          {me && <Link href="/library">Library</Link>}
        </div>
      </div>
      <div className="lp-nav-right">
        <Link href="/search" className="hm-icon" aria-label="Search">
          <svg width="22" height="22" viewBox="0 0 22 22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><circle cx="10.08" cy="10.08" r="7.33" /><path d="m19.25 19.25-3.94-3.94" /></svg>
        </Link>
        <LocalePicker country={country} lang={lang} signedIn={Boolean(me)} />
        {me ? (
          <AccountMenu name={me.name} email={me.email} />
        ) : (
          <>
            <Link href="/signin" className="lp-btn sm ghost tn-signin">{t.signIn}</Link>
            <Link href="/join" className="lp-btn sm">{t.joinFree}</Link>
          </>
        )}
      </div>
    </nav>
  );
}
