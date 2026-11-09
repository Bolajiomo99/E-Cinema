"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode, useEffect } from "react";
import Logo from "@/components/landing/Logo";
import { EXEC_NAV, ROLE_LABEL } from "@/lib/exec-types";

// The executive sidebar (Figma 49:1055): wordmark with the purple "EXECUTIVE" label, the person's
// card and twenty pages. On phones it slides in from the menu button, like the studio portal.
const P: Record<string, ReactNode> = {
  crown: <path d="M3 8l4.5 4L12 5l4.5 7L21 8l-2 11H5z" />,
  money: <><rect x="3" y="6" width="18" height="12" rx="2" /><circle cx="12" cy="12" r="2.5" /></>,
  trend: <path d="M3 17l6-6 4 4 8-8m0 0h-5m5 0v5" />,
  film: <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M7 4v16M17 4v16M3 9h4M3 15h4M17 9h4M17 15h4" /></>,
  live: <><circle cx="12" cy="12" r="2" /><path d="M8.5 8.5a5 5 0 0 0 0 7m7 0a5 5 0 0 0 0-7M5.6 5.6a9 9 0 0 0 0 12.8m12.8 0a9 9 0 0 0 0-12.8" /></>,
  bag: <path d="M5 8h14l-1 12H6zM9 8V6a3 3 0 0 1 6 0v2" />,
  door: <path d="M5 21V4h11v17M16 6h3v15M3 21h18M12.5 12.5h.01" />,
  shield: <path d="M12 3 5 6v5c0 4.5 3 8 7 10 4-2 7-5.5 7-10V6z" />,
  case: <><rect x="3" y="7" width="18" height="13" rx="2" /><path d="M9 7V5h6v2M3 13h18" /></>,
  badge: <path d="M12 3 5 6v5c0 4.5 3 8 7 10 4-2 7-5.5 7-10V6zM9 12l2 2 4-4" />,
  tag: <path d="M3 12V4h8l10 10-8 8zM7.5 7.5h.01" />,
  lock: <><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></>,
  server: <><rect x="4" y="4" width="16" height="7" rx="1.5" /><rect x="4" y="13" width="16" height="7" rx="1.5" /><path d="M8 7.5h.01M8 16.5h.01" /></>,
  pie: <path d="M12 3v9h9A9 9 0 1 1 12 3zm3 0a7 7 0 0 1 6 6h-6z" />,
  people: <><circle cx="9" cy="8" r="3" /><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6M16 5.5a3 3 0 0 1 0 5.5M21 20c0-2.6-1.6-4.8-4-5.6" /></>,
  hands: <path d="M3 12l4-4 4 3 3-3 7 5-5 5-3-2-2 2-4-3zM7 8l3-3 4 3" />,
  key: <><circle cx="8" cy="15" r="4" /><path d="M11 12l9-9m-3 3 3 3m-6 0 2 2" /></>,
  heart: <path d="M12 20s-7-4.5-7-10a4 4 0 0 1 7-2.5A4 4 0 0 1 19 10c0 5.5-7 10-7 10z" />,
  bell: <path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4zM10 20a2 2 0 0 0 4 0" />,
  gear: <><circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1" /></>,
};

function Icon({ name, size = 18 }: { name: string; size?: number }) {
  return <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>{P[name]}</svg>;
}

export default function ExecShell({ name, role, money, idleMinutes = 0, children }: { name: string; role: string; money: boolean; idleMinutes?: number; children: ReactNode }) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  // Settings > "Session timeout": sign out after this many idle minutes (0 = off).
  useEffect(() => {
    if (!idleMinutes) return;
    let timer = 0;
    const out = async () => {
      await fetch("/api/auth/signout", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }).catch(() => {});
      window.location.href = `/signin?next=${encodeURIComponent(window.location.pathname)}`;
    };
    const reset = () => { window.clearTimeout(timer); timer = window.setTimeout(out, idleMinutes * 60_000); };
    const evs = ["pointerdown", "keydown", "scroll", "pointermove"] as const;
    evs.forEach((e) => window.addEventListener(e, reset, { passive: true }));
    reset();
    return () => { window.clearTimeout(timer); evs.forEach((e) => window.removeEventListener(e, reset)); };
  }, [idleMinutes]);
  const on = (href: string) => path === href || (href === "/executive" ? path === "/executive/overview" : href === "/executive/money" ? path === "/executive/payments" : path.startsWith(href + "/"));
  const ini = name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "EC";
  const first = name.trim().split(/\s+/)[0] || "Executive";
  return (
    <div className={`pt exs ${open ? "open" : ""}`}>
      <aside className="pt-side" aria-label="Executive menu">
        <div className="pt-brand">
          <Logo href="/home" />
          <b>EXECUTIVE</b>
        </div>
        <div className="pt-who">
          <span>{ini}</span>
          <div><b>{first} · {ROLE_LABEL[role] ?? "Executive"}</b><small>{role === "ceo" ? "Full access" : `${ROLE_LABEL[role] ?? "Limited"} access`}</small></div>
        </div>
        <nav>
          {EXEC_NAV.filter((n) => role === "ceo" || n.roles?.includes(role) || (n.money && money)).map((n) => n.href ? (
            <Link key={n.label} href={n.href} className={`pt-item ${on(n.href) ? "on" : ""}`} aria-current={on(n.href) ? "page" : undefined} onClick={() => setOpen(false)}>
              <Icon name={n.icon} />{n.label}{n.lock && <i className="exs-lock" title="Executives only"><Icon name="lock" size={13} /></i>}
            </Link>
          ) : (
            <span key={n.label} className="pt-item off" aria-disabled="true"><Icon name={n.icon} />{n.label}<em className="soon-tag">Soon</em></span>
          ))}
        </nav>
      </aside>
      {open && <button className="pt-scrim" aria-label="Close menu" onClick={() => setOpen(false)} />}
      <main id="main" className="pt-main">
        <button className="pt-menu" aria-label="Open menu" aria-expanded={open} onClick={() => setOpen(true)}>
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden><path d="M4 7h16M4 12h16M4 17h16" /></svg>
        </button>
        {children}
      </main>
    </div>
  );
}
