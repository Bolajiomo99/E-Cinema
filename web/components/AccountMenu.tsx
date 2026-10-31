"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

// Avatar menu from Figma "Web / Account menu · open" (315:2619).
// Sign out ends this device's session only; other devices are managed under Devices.
export default function AccountMenu({ name, email }: { name?: string; email?: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [who, setWho] = useState({ name: name ?? "", email: email ?? "" });
  const [busy, setBusy] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    if (!who.email) {
      fetch("/api/auth/me").then((r) => (r.ok ? r.json() : null)).then((d) => {
        const a = d?.account ?? d;
        if (a?.email) setWho({ name: a.name ?? "", email: a.email });
      }).catch(() => {});
    }
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", close); };
  }, [open, who.email]);

  async function signOut() {
    setBusy(true);
    await fetch("/api/auth/signout", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }).catch(() => {});
    setOpen(false);
    router.push("/");
    router.refresh();
  }

  const initials = (who.name || who.email || "?").split(/[\s@]/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("");

  return (
    <div className="acct" ref={wrap}>
      <button type="button" className="hm-avatar" aria-haspopup="menu" aria-expanded={open} aria-label="Account menu" onClick={() => setOpen((o) => !o)}>
        {initials}
      </button>
      {open && (
        <div className="acct-menu" role="menu">
          <div className="acct-who">
            <span className="acct-av" aria-hidden>{initials}</span>
            <div>
              <strong>{who.name || "Your account"}</strong>
              <small>{who.email}</small>
            </div>
          </div>
          <hr />
          <Link role="menuitem" href="/home" onClick={() => setOpen(false)}>My home</Link>
          <Link role="menuitem" href="/home#calendar" onClick={() => setOpen(false)}>My seats</Link>
          <Link role="menuitem" href="/settings/security" onClick={() => setOpen(false)}>Devices <small>2 at most</small></Link>
          <Link role="menuitem" href="/settings/account" onClick={() => setOpen(false)}>Settings</Link>
          <Link role="menuitem" href="/concierge" onClick={() => setOpen(false)}>Help</Link>
          <hr />
          <Link role="menuitem" href="/" onClick={() => setOpen(false)}>Back to the landing page</Link>
          <hr />
          <button role="menuitem" type="button" className="acct-out" onClick={signOut} disabled={busy}>{busy ? "Signing out…" : "Sign out"}</button>
        </div>
      )}
    </div>
  );
}
