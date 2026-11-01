"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import Logo from "@/components/landing/Logo";

// The signed-in dashboard sidebar from Figma (My tickets 31:605, Library 19:583, Notifications 31:878).
// On Home it starts closed, matching the top-nav frame, and the toggle opens it; on the
// other dashboard pages it starts open. The choice is remembered per browser.
type Item = { label: string; href?: string; icon: ReactNode };

const I = (d: ReactNode) => (
  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>{d}</svg>
);

export const ITEMS: Item[] = [
  { label: "Home", href: "/home", icon: I(<><rect x="3.5" y="3.5" width="7" height="7" rx="1.5" /><rect x="13.5" y="3.5" width="7" height="7" rx="1.5" /><rect x="3.5" y="13.5" width="7" height="7" rx="1.5" /><rect x="13.5" y="13.5" width="7" height="7" rx="1.5" /></>) },
  { label: "My tickets", href: "/tickets", icon: I(<path d="M3 8a2 2 0 0 0 2-2h14a2 2 0 0 0 2 2v2a2 2 0 0 0 0 4v2a2 2 0 0 0-2 2H5a2 2 0 0 0-2-2v-2a2 2 0 0 0 0-4z" />) },
  { label: "Library", href: "/library", icon: I(<><rect x="3.5" y="3.5" width="17" height="17" rx="2" /><path d="M7.5 3.5v17M16.5 3.5v17M3.5 8h4M3.5 12h17M3.5 16h4M16.5 8h4M16.5 16h4" /></>) },
  { label: "Downloads", icon: I(<><path d="M12 4v11M7.5 10.5 12 15l4.5-4.5" /><path d="M4 16v2.5A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V16" /></>) },
  { label: "Messages", icon: I(<path d="M20.5 11.5a8 8 0 0 1-11.8 7l-4.2 1.2 1.2-4A8 8 0 1 1 20.5 11.5z" />) },
  { label: "Notifications", icon: I(<><path d="M6 9a6 6 0 0 1 12 0c0 6 2.5 7.5 2.5 7.5h-17S6 15 6 9z" /><path d="M10.3 20a1.9 1.9 0 0 0 3.4 0" /></>) },
  { label: "Insights", icon: I(<path d="M4 4v16h16M8.5 16v-4M12.5 16V8M16.5 16v-6" />) },
  { label: "Watch parties", href: "/parties", icon: I(<><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.6a3.5 3.5 0 0 1 0 6.8M18.5 14.4a6.5 6.5 0 0 1 3 5.6" /></>) },
  { label: "Settings", href: "/settings/account", icon: I(<><circle cx="12" cy="12" r="3" /><path d="M12 2.5v2.5M12 19v2.5M4.6 4.6l1.8 1.8M17.6 17.6l1.8 1.8M2.5 12H5M19 12h2.5M4.6 19.4l1.8-1.8M17.6 6.4l1.8-1.8" /></>) },
];

const Ctx = createContext<{ open: boolean; toggle: () => void }>({ open: false, toggle: () => {} });
const KEY = "ec.sidebar";

export function DashShell({ children, defaultOpen = false }: { children: ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const path = usePathname();

  useEffect(() => {
    try {
      const saved = localStorage.getItem(KEY);
      // Phones always start closed, so the drawer never covers a page on arrival.
      if (saved && window.matchMedia("(min-width: 901px)").matches) setOpen(saved === "open");
    } catch {}
  }, []);

  useEffect(() => {
    if (!window.matchMedia("(min-width: 901px)").matches) setOpen(false);
  }, [path]);

  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !window.matchMedia("(min-width: 901px)").matches) setOpen(false);
    };
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [open]);

  const toggle = useCallback(() => {
    setOpen((o) => {
      try { localStorage.setItem(KEY, o ? "closed" : "open"); } catch {}
      return !o;
    });
  }, []);

  return (
    <Ctx.Provider value={{ open, toggle }}>
      <div className={`dash ${open ? "open" : ""}`}>
        <aside className="dash-side" id="dash-side" aria-label="Your E-Cinema" aria-hidden={!open} inert={!open}>
          <div className="dash-side-top">
            <Logo />
            <SidebarToggle inside />
          </div>
          <nav>
            {ITEMS.map((it) => {
              const on = it.href && (path === it.href || (it.href !== "/home" && path.startsWith(it.href.split("/").slice(0, 2).join("/"))));
              return it.href ? (
                <Link key={it.label} href={it.href} className={`dash-item${on ? " on" : ""}`} aria-current={on ? "page" : undefined}>
                  {it.icon}<span>{it.label}</span>
                </Link>
              ) : (
                <span key={it.label} className="dash-item soon" aria-disabled="true" title={`${it.label} is coming soon`}>
                  {it.icon}<span>{it.label}</span><em>Soon</em>
                </span>
              );
            })}
          </nav>
        </aside>
        <button type="button" className="dash-scrim" aria-label="Close the menu" tabIndex={-1} onClick={toggle} />
        <div className="dash-main">{children}</div>
      </div>
    </Ctx.Provider>
  );
}

export function SidebarToggle({ inside = false }: { inside?: boolean }) {
  const { open, toggle } = useContext(Ctx);
  return (
    <button
      type="button"
      className={`dash-toggle${inside ? " inside" : ""}`}
      onClick={toggle}
      aria-controls="dash-side"
      aria-expanded={open}
      aria-label={open ? "Hide the sidebar" : "Show the sidebar"}
      title={open ? "Hide the sidebar" : "Show the sidebar"}
    >
      <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" aria-hidden>
        <rect x="3" y="4.5" width="18" height="15" rx="3" />
        <path d="M9.5 4.5v15" />
        <path d="M5.5 8.5h1.5M5.5 11.5h1.5" strokeLinecap="round" />
      </svg>
    </button>
  );
}
