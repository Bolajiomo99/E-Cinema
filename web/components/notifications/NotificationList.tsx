"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";

// Rows from Figma 31:878: unread rows sit on a card with a red dot, read rows are flat.
type Note = { id: number; kind: string; title: string; body: string; link: string; createdAt: string; readAt: string | null };

const I = (d: ReactNode) => (
  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>{d}</svg>
);
const bell = I(<><path d="M6 9a6 6 0 0 1 12 0c0 6 2.5 7.5 2.5 7.5h-17S6 15 6 9z" /><path d="M10.3 20a1.9 1.9 0 0 0 3.4 0" /></>);
const people = I(<><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.6a3.5 3.5 0 0 1 0 6.8M18.5 14.4a6.5 6.5 0 0 1 3 5.6" /></>);
const ticket = I(<path d="M3 8a2 2 0 0 0 2-2h14a2 2 0 0 0 2 2v2a2 2 0 0 0 0 4v2a2 2 0 0 0-2 2H5a2 2 0 0 0-2-2v-2a2 2 0 0 0 0-4z" />);
const chat = I(<path d="M20.5 11.5a8 8 0 0 1-11.8 7l-4.2 1.2 1.2-4A8 8 0 1 1 20.5 11.5z" />);
const globe = I(<><circle cx="12" cy="12" r="8.5" /><path d="M3.5 12h17M12 3.5c2.5 2.6 3.5 5.4 3.5 8.5s-1 5.9-3.5 8.5c-2.5-2.6-3.5-5.4-3.5-8.5s1-5.9 3.5-8.5z" /></>);
const shield = I(<><path d="M12 3.5 5 6v5.5c0 4.3 3 7.6 7 9 4-1.4 7-4.7 7-9V6z" /><path d="M12 9v3.5M12 15.5v.01" /></>);
const card = I(<><rect x="3" y="5.5" width="18" height="13" rx="2" /><path d="M3 10h18M7 15h3" /></>);
const back = I(<><path d="M9 7 4.5 11.5 9 16" /><path d="M5 11.5h9a5 5 0 0 1 0 10h-2" /></>);
const folder = I(<path d="M3.5 7a2 2 0 0 1 2-2h4l2 2h7a2 2 0 0 1 2 2v8.5a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z" />);
const gift = I(<><rect x="3.5" y="8.5" width="17" height="4" rx="1" /><path d="M5 12.5v7h14v-7M12 8.5v11M12 8.5S10.5 4 8 4.5 7 8.5 12 8.5zM12 8.5s1.5-4.5 4-4 1 4-4 4z" /></>);

export const KINDS: Record<string, { icon: ReactNode; tone: string }> = {
  premiere: { icon: bell, tone: "red" },
  party: { icon: people, tone: "blue" },
  lottery: { icon: ticket, tone: "gold" },
  reply: { icon: chat, tone: "green" },
  language: { icon: globe, tone: "violet" },
  signin: { icon: shield, tone: "amber" },
  payment: { icon: card, tone: "green" },
  refund: { icon: back, tone: "amber" },
  share: { icon: folder, tone: "blue" },
  gift: { icon: gift, tone: "gold" },
  news: { icon: bell, tone: "violet" },
};

function ago(iso: string, now: number): string {
  const s = Math.max(0, (now - Date.parse(iso)) / 1000);
  if (s < 60) return "now";
  if (s < 3600) return `${Math.floor(s / 60)} min`;
  if (s < 86400) return `${Math.floor(s / 3600)} h`;
  if (s < 2 * 86400) return "Yesterday";
  if (s < 7 * 86400) return new Date(iso).toLocaleDateString("en-GB", { weekday: "long" });
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

export function MarkAllRead({ disabled }: { disabled: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <button type="button" className="nt-markall" disabled={disabled || busy} onClick={async () => {
      setBusy(true);
      await fetch("/api/notifications/all/read", { method: "POST" }).catch(() => undefined);
      window.dispatchEvent(new Event("ec:notifications"));
      router.refresh();
      setBusy(false);
    }}>Mark all read</button>
  );
}

export default function NotificationList({ notes, empty }: { notes: Note[]; empty: string }) {
  const router = useRouter();
  const [now, setNow] = useState(() => Date.now());
  const [read, setRead] = useState<Set<number>>(new Set());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30000);
    // New notifications arrive while the page is open.
    const r = setInterval(() => document.visibilityState === "visible" && router.refresh(), 30000);
    return () => { clearInterval(t); clearInterval(r); };
  }, [router]);

  if (!notes.length) return <div className="nt-empty">{bell}<p>{empty}</p></div>;

  const open = async (n: Note) => {
    if (!n.readAt && !read.has(n.id)) {
      setRead((s) => new Set(s).add(n.id));
      fetch(`/api/notifications/${n.id}/read`, { method: "POST" }).then(() => window.dispatchEvent(new Event("ec:notifications"))).catch(() => undefined);
    }
    if (n.link) router.push(n.link);
  };

  return (
    <ul className="nt-list">
      {notes.map((n) => {
        const k = KINDS[n.kind] ?? KINDS.premiere;
        const unread = !n.readAt && !read.has(n.id);
        return (
          <li key={n.id}>
            <button type="button" className={`nt-row${unread ? " unread" : ""}`} onClick={() => open(n)}>
              <span className={`nt-ic ${k.tone}`}>{k.icon}</span>
              <span className="nt-t"><strong>{n.title}</strong>{n.body && <span>{n.body}</span>}</span>
              <span className="nt-r"><time dateTime={n.createdAt}>{ago(n.createdAt, now)}</time>{unread && <i aria-label="Unread" />}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
