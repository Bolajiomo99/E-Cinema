"use client";

import { useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import Logo from "@/components/landing/Logo";

// Settings sidebar (Figma 93:901). On phones it becomes a scrolling row of tabs.
const P = {
  account: <><circle cx="12" cy="8" r="4" /><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6" /></>,
  security: <path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z" />,
  language: <><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c2.5 2.5 3.5 5.5 3.5 9s-1 6.5-3.5 9c-2.5-2.5-3.5-5.5-3.5-9s1-6.5 3.5-9z" /></>,
  plan: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 10h18" /></>,
  kids: <><circle cx="12" cy="7" r="3" /><path d="M6 21v-2a6 6 0 0 1 12 0v2" /></>,
  notifications: <><path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4z" /><path d="M10 21h4" /></>,
  "data-saver": <path d="M5 20v-2M10 20v-5M15 20v-9M20 20V7" />,
  privacy: <><circle cx="8" cy="15" r="4" /><path d="m11 12 8-8m-3 3 2 2m-4 0 2 2" /></>,
};

export const SECTIONS: { id: keyof typeof P; label: string; soon?: boolean }[] = [
  { id: "account", label: "Account" },
  { id: "security", label: "Security and devices" },
  { id: "language", label: "Language and region" },
  { id: "plan", label: "Plan and payments" },
  { id: "kids", label: "Kids and parental", soon: true },
  { id: "notifications", label: "Notifications" },
  { id: "data-saver", label: "Data saver" },
  { id: "privacy", label: "Privacy and data" },
];

export default function SettingsNav() {
  const path = usePathname();
  // On phones the tabs scroll sideways; keep the open one in view.
  useEffect(() => {
    document.querySelector(".st-item.on")?.scrollIntoView({ block: "nearest", inline: "center" });
  }, [path]);
  return (
    <nav className="st-nav" aria-label="Settings">
      <div className="st-logo"><Logo /></div>
      <a className="st-back" href="/home">‹ Back to my home</a>
      <p className="st-eyebrow">SETTINGS</p>
      <ul>
        {SECTIONS.map((s) => {
          const on = path === `/settings/${s.id}`;
          return (
            <li key={s.id}>
              {s.soon ? (
                <span className="st-item soon" aria-disabled title="Family and kids profiles are coming soon">
                  <Ico d={P[s.id]} />{s.label}<span className="soon-tag">Soon</span>
                </span>
              ) : (
                <Link href={`/settings/${s.id}`} className={`st-item${on ? " on" : ""}`} aria-current={on ? "page" : undefined}>
                  <Ico d={P[s.id]} />{s.label}
                </Link>
              )}
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

function Ico({ d }: { d: React.ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>{d}</svg>
  );
}
