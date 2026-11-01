"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";
import Logo from "@/components/landing/Logo";
import { PARTNER_NAV, type Licensee } from "@/lib/licensing-types";

// The licensed partner sidebar (Figma 116:192): wordmark, teal "LICENSED PARTNER", the company
// card and eight pages. On phones it slides in from the menu button.
export default function PartnerShell({ licensee: l, children }: { licensee: Licensee; children: ReactNode }) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const initials = l.name.replace(/\b(ltd|limited|plc|inc|llc|&|co)\b/gi, "").trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
  return (
    <div className={`pt ${open ? "open" : ""}`}>
      <aside className="pt-side" aria-label="Partner menu">
        <div className="pt-brand">
          <Logo href="/home" />
          <b>LICENSED PARTNER</b>
        </div>
        <div className="pt-who">
          <span>{initials || "LP"}</span>
          <div><b>{l.name}</b><small>{l.plan.name} · licence {l.licence}</small></div>
        </div>
        <nav>
          {PARTNER_NAV.map(([label, href]) => (
            <Link key={href} href={href} className={`pt-item ${path === href ? "on" : ""}`} aria-current={path === href ? "page" : undefined} onClick={() => setOpen(false)}>{label}</Link>
          ))}
        </nav>
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
