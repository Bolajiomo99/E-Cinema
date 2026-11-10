import Link from "next/link";
import Logo from "@/components/landing/Logo";
import AccountMenu from "@/components/AccountMenu";
import LocalePicker from "@/components/LocalePicker";
import CartLink from "@/components/store/CartLink";
import { SidebarToggle } from "@/components/dash/DashShell";
import type { dict } from "@/lib/i18n";

// The viewer top nav from the Figma discover frames (Browse 30:564, Search 30:750).
// Pages that are not built yet stay visible but marked "soon", never linked to a fake page.
type Me = { name: string; email: string } | null;

export default function TopNav({ me, active, t, country, lang }: { me: Me; active?: "home" | "coming" | "live" | "clips" | "community" | "shop" | "library"; t: ReturnType<typeof dict>; country?: string; lang: string }) {
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
          <Link href="/shop" className={cls("shop")}>Shop</Link>
          {me ? <Link href="/library" className={cls("library")}>Library</Link> : <Link href="/signin?next=/library">Library</Link>}
        </div>
      </div>
      <div className="lp-nav-right">
        <Link href="/search" className="hm-icon" aria-label="Search">
          <svg width="22" height="22" viewBox="0 0 22 22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><circle cx="10.08" cy="10.08" r="7.33" /><path d="m19.25 19.25-3.94-3.94" /></svg>
        </Link>
        {me && (
          <Link href="/notifications" className="hm-icon" aria-label="Notifications">
            <svg width="22" height="22" viewBox="0 0 22 22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M5.5 7.33a5.5 5.5 0 0 1 11 0c0 6.42 2.75 8.25 2.75 8.25H2.75S5.5 13.75 5.5 7.33Z" /><path d="M9.41 19.25a1.83 1.83 0 0 0 3.18 0" /></svg>
          </Link>
        )}
        {me && <CartLink />}
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
