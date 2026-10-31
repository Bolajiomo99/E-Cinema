import Link from "next/link";

export default function SiteNav({ signedIn }: { signedIn: boolean }) {
  return (
    <nav className="site-nav">
      <Link href="/" className="wordmark" aria-label="E-Cinema home">E-CINEMA</Link>
      <div className="nav-links">
        <Link href="/checkout">Premieres</Link>
        <Link href="/releases">Release calendar</Link>
        <Link href="/concierge">Concierge</Link>
      </div>
      <div className="nav-actions">
        {signedIn ? (
          <Link href="/account/devices" className="nav-btn">My account</Link>
        ) : (
          <>
            <Link href="/signin" className="nav-btn">Sign in</Link>
            <Link href="/join" className="nav-btn red">Join free</Link>
          </>
        )}
      </div>
    </nav>
  );
}
