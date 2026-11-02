"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import Logo from "@/components/landing/Logo";
import { STUDIO_NAV, type Studio } from "@/lib/studio-types";
import { nameOf } from "@/lib/countries";

// The studio sidebar (Figma 34:272): wordmark with the gold "STUDIO" label, the studio card,
// twelve pages and the Studio AI box. On phones it slides in from the menu button.
const P: Record<string, ReactNode> = {
  home: <path d="M4 11 12 4l8 7v8a1 1 0 0 1-1 1h-4v-6H9v6H5a1 1 0 0 1-1-1z" />,
  film: <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M7 4v16M17 4v16M3 9h4M3 15h4M17 9h4M17 15h4" /></>,
  upload: <path d="M12 16V4m0 0-4 4m4-4 4 4M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3" />,
  calendar: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" /></>,
  dub: <path d="M4 5h8M8 3v2m2.5 0C10 9 7 12 4 13m3-4c1 2 3 3.5 5 4m1 7 4-9 4 9m-6.5-3h5" />,
  live: <><circle cx="12" cy="12" r="2" /><path d="M8.5 8.5a5 5 0 0 0 0 7m7 0a5 5 0 0 0 0-7M5.6 5.6a9 9 0 0 0 0 12.8m12.8 0a9 9 0 0 0 0-12.8" /></>,
  chart: <path d="M4 20V4m0 16h16M8 16v-4m4 4V8m4 8v-6" />,
  wallet: <><path d="M4 7a2 2 0 0 1 2-2h11v4" /><rect x="4" y="7" width="16" height="13" rx="2" /><circle cx="16" cy="13.5" r="1.2" /></>,
  shield: <path d="M12 3 5 6v5c0 4.5 3 8 7 10 4-2 7-5.5 7-10V6z" />,
  megaphone: <path d="M4 10v4h3l7 4V6L7 10zm14-1a4 4 0 0 1 0 6" />,
  team: <><circle cx="9" cy="8" r="3" /><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6M16 5.5a3 3 0 0 1 0 5.5M21 20c0-2.6-1.6-4.8-4-5.6" /></>,
  bell: <path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4zM10 20a2 2 0 0 0 4 0" />,
  gear: <><circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1" /></>,
};

export function Icon({ name, size = 18 }: { name: string; size?: number }) {
  return <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>{P[name]}</svg>;
}

export function initials(name: string) {
  return name.replace(/\b(ltd|limited|plc|inc|llc|&|co)\b/gi, "").trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "ST";
}

export default function StudioShell({ studio: s, children }: { studio: Studio; children: ReactNode }) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const on = (href: string) => path === href || (href !== "/studio" && path.startsWith(href + "/"));
  const [unread, setUnread] = useState(0);
  // The bell's count, fetched again whenever the studio moves to another page.
  useEffect(() => {
    if (s.status !== "verified") return;
    let live = true;
    fetch("/api/studio/notices").then((r) => (r.ok ? r.json() : null)).then((j) => { if (live && j) setUnread(Number(j.unread) || 0); }).catch(() => {});
    return () => { live = false; };
  }, [path, s.status]);
  const place = [s.city || nameOf(s.regCountry), s.status === "verified" ? "Verified studio" : "Waiting for checks"].filter(Boolean).join(" · ");
  return (
    <div className={`pt stu ${open ? "open" : ""}`}>
      <aside className="pt-side" aria-label="Studio menu">
        <div className="pt-brand">
          <Logo href="/home" />
          <b>STUDIO</b>
          {s.status === "verified" && (
            <Link href="/studio/notifications" className={`stu-bell${on("/studio/notifications") ? " on" : ""}`} onClick={() => setOpen(false)} aria-label={unread ? `Notifications, ${unread} unread` : "Notifications"}>
              <Icon name="bell" size={20} />{unread > 0 && <b>{unread > 99 ? "99+" : unread}</b>}
            </Link>
          )}
        </div>
        <div className="pt-who">
          <span>{initials(s.name)}</span>
          <div><b>{s.name}</b><small>{place}</small></div>
        </div>
        <nav>
          {STUDIO_NAV.map((n) => n.href ? (
            <Link key={n.label} href={n.href} className={`pt-item ${on(n.href) ? "on" : ""}`} aria-current={on(n.href) ? "page" : undefined} onClick={() => setOpen(false)}>
              <Icon name={n.icon} />{n.label}
            </Link>
          ) : (
            <span key={n.label} className="pt-item off" aria-disabled="true"><Icon name={n.icon} />{n.label}<em className="soon-tag">Soon</em></span>
          ))}
        </nav>
        <Link href="/studio/ai" className={`stu-ai${on("/studio/ai") ? " on" : ""}`} onClick={() => setOpen(false)}>
          <b><svg viewBox="0 0 24 24" width="14" height="14" fill="#d4a23a" aria-hidden><path d="M12 2l1.8 6.2L20 10l-6.2 1.8L12 18l-1.8-6.2L4 10l6.2-1.8z" /></svg>Studio AI</b>
          <p>Ask anything about your films, audience or money.</p>
        </Link>
      </aside>
      {open && <button className="pt-scrim" aria-label="Close menu" onClick={() => setOpen(false)} />}
      <main className="pt-main">
        <button className="pt-menu" aria-label="Open menu" aria-expanded={open} onClick={() => setOpen(true)}>
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden><path d="M4 7h16M4 12h16M4 17h16" /></svg>
        </button>
        {children}
      </main>
    </div>
  );
}
