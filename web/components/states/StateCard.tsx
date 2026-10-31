import Link from "next/link";
import type { ReactNode } from "react";

// The system states from Figma 33:1044: one centred card with a tinted icon tile,
// a title, one or two lines of text and a single action.
export type StateIcon = "capture" | "offline" | "globe" | "film" | "shield" | "search";

const paths: Record<StateIcon, ReactNode> = {
  capture: (<><path d="M3 3l18 18" /><path d="M10.6 5.1A10 10 0 0 1 12 5c5 0 9 4.5 10 7a13 13 0 0 1-3.2 4.2M6.6 6.6A13 13 0 0 0 2 12c1 2.5 5 7 10 7a9.8 9.8 0 0 0 5.4-1.6" /><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" /></>),
  offline: (<><path d="M3 3l18 18" /><path d="M8.5 16.4a5 5 0 0 1 7 0M5 12.9a10 10 0 0 1 4.2-2.5M2 8.8A15 15 0 0 1 6 6.3M19 12.9a10 10 0 0 0-2.6-1.9M22 8.8A15 15 0 0 0 11 5.1" /><circle cx="12" cy="20" r=".6" /></>),
  globe: (<><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" /></>),
  film: (<><rect x="4" y="3" width="16" height="18" rx="2" /><path d="M8 3v18M16 3v18M4 8h4M4 12h16M4 16h4M16 8h4M16 16h4" /></>),
  shield: <path d="M12 3l7 3v5c0 4.5-3 8.3-7 10-4-1.7-7-5.5-7-10V6z" />,
  search: (<><circle cx="11" cy="11" r="6.5" /><path d="M16 16l4.5 4.5" /></>),
};

type Action = { label: string; href?: string; onClick?: () => void; primary?: boolean };

export default function StateCard({ icon, title, children, action, overlay }: {
  icon: StateIcon;
  title: string;
  children: ReactNode;
  action?: Action;
  overlay?: boolean; // sits over the player instead of filling the page
}) {
  const cls = `state-btn${action?.primary ? " primary" : ""}`;
  return (
    <div className={`state${overlay ? " overlay" : ""}`} role={overlay ? "alertdialog" : undefined} aria-live={overlay ? "assertive" : undefined}>
      <div className="state-card">
        <span className={`state-icon ${icon}`} aria-hidden>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{paths[icon]}</svg>
        </span>
        <h1>{title}</h1>
        <p>{children}</p>
        {action && (action.href
          ? <Link href={action.href} className={cls}>{action.label}</Link>
          : <button type="button" className={cls} onClick={action.onClick}>{action.label}</button>)}
      </div>
    </div>
  );
}
