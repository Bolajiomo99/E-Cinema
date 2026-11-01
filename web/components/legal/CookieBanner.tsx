"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSyncExternalStore } from "react";
import { ALL, NONE, readConsent, saveConsent } from "./consent";

function subscribe(cb: () => void) { window.addEventListener("ec-consent", cb); return () => window.removeEventListener("ec-consent", cb); }

// Site-wide cookie banner (Figma 89:1091). Shown until the viewer makes a choice.
export default function CookieBanner() {
  const asked = useSyncExternalStore(subscribe, () => readConsent() !== null, () => true);
  const path = usePathname();
  if (asked || path === "/cookies" || path?.startsWith("/watch")) return null;
  return (
    <div className="ck-banner" role="region" aria-label="Cookies">
      <p><b>We use cookies</b>Essential ones keep you signed in and safe. Extras help us improve and are off until you say yes.</p>
      <div>
        <Link className="vf-btn ghost" href="/cookies">Choose</Link>
        <button className="vf-btn ghost" type="button" onClick={() => saveConsent(NONE)}>Reject extras</button>
        <button className="vf-btn red" type="button" onClick={() => saveConsent(ALL)}>Accept all</button>
      </div>
    </div>
  );
}
