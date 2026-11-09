import Link from "next/link";

// The E-Cinema wordmark over the curved screen line (Figma component 11:6).
export default function Logo({ href = "/" }: { href?: string }) {
  return (
    <Link href={href} className="lp-logo" aria-label="E-Cinema home" translate="no">
      <span>E-CINEMA</span>
      <img src="/landing/screen-arc.svg" alt="" width={116} height={8} />
    </Link>
  );
}
