"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// Phone and tablet navigation, from the Android "Bottom nav" in Figma (23:105).
// Same five tabs as the app so the web and the app feel like one product.
const icons: Record<string, React.ReactNode> = {
  home: <path d="M2.75 8.25 11 1.83l8.25 6.42v10.08a1.83 1.83 0 0 1-1.83 1.84H4.58a1.83 1.83 0 0 1-1.83-1.84V8.25Z" />,
  premieres: (
    <>
      <rect x="2.75" y="2.75" width="16.5" height="16.5" rx="1.83" />
      <path d="M6.42 2.75v16.5M2.75 6.88h3.67M2.75 11h16.5M2.75 15.13h3.67M15.58 2.75v16.5M15.58 6.88h3.67M15.58 15.13h3.67" />
    </>
  ),
  clips: (
    <>
      <rect x="4.58" y="1.83" width="12.83" height="18.33" rx="1.83" />
      <path d="M9.17 8.25 13.75 11l-4.58 2.75v-5.5Z" />
    </>
  ),
  parties: (
    <>
      <path d="M14.67 19.25v-1.83a3.67 3.67 0 0 0-3.67-3.67H5.5a3.67 3.67 0 0 0-3.67 3.67v1.83" />
      <circle cx="8.25" cy="6.42" r="3.67" />
      <path d="M20.17 19.25v-1.83a3.67 3.67 0 0 0-2.75-3.55" />
    </>
  ),
  me: (
    <>
      <circle cx="11" cy="7.33" r="4.58" />
      <path d="M18.33 19.25a7.33 7.33 0 0 0-14.66 0" />
    </>
  ),
};

export default function TabBar({ signedIn }: { signedIn: boolean }) {
  const path = usePathname() ?? "/";
  // Full-screen flows hide the tab bar: watch rooms, and sign-up / sign-in like the Android frames.
  if (/^\/(room\/|join|signin|forgot|account\/lock)/.test(path)) return null;
  const home = signedIn ? "/home" : "/";
  const tabs = [
    { key: "home", label: "Home", href: home, on: path === "/" || path === "/home" },
    { key: "premieres", label: "Premieres", href: "/releases", on: path.startsWith("/releases") },
    { key: "clips", label: "Clips", href: signedIn ? "/home#hm-clips" : null, on: false },
    { key: "parties", label: "Parties", href: signedIn ? "/home#hm-parties" : "/#premieres", on: path.startsWith("/p/") || path.startsWith("/parties") },
    { key: "me", label: "Me", href: signedIn ? "/settings/account" : "/signin", on: path.startsWith("/settings") || path.startsWith("/account") || path === "/signin" },
  ];
  return (
    <nav className="tabbar" aria-label="Main">
      {tabs.map((t) => {
        const inner = (
          <>
            <svg viewBox="0 0 22 22" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              {icons[t.key]}
            </svg>
            <span>{t.label}</span>
            {!t.href && <em>Soon</em>}
          </>
        );
        return t.href ? (
          <Link key={t.key} href={t.href} className={t.on ? "on" : undefined} aria-current={t.on ? "page" : undefined}>{inner}</Link>
        ) : (
          <span key={t.key} className="off" aria-disabled="true" title="Short clips are coming soon">{inner}</span>
        );
      })}
    </nav>
  );
}
