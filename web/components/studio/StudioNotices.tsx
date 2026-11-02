"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { dubName } from "@/lib/dub-types";
import { money } from "@/lib/studio-types";
import { scall } from "./scall";

// Figma "Studio / Notifications" (99:552): everything that needs the studio's attention, worked
// out from what happened. "Mark all read" is per member.

type Notice = { id: string; type: string; group: string; action: boolean; at: string; film: string; lang: string; text: string; num: number; currency: string; ref: string };
export type NoticeData = { notices: Notice[]; seenAt: string | null; unread: number; action: number };

const PLACES: Record<string, string> = { website: "a website", telegram: "Telegram", tiktok: "TikTok", youtube: "YouTube", x: "X", instagram: "Instagram", facebook: "Facebook", whatsapp: "WhatsApp", other: "another site" };
const KINDS: Record<string, string> = { clip: "clip", full: "full copy", screenshot: "still", other: "copy" };
const ROLES: Record<string, string> = { admin: "an admin", finance: "finance", marketing: "marketing", viewer: "a viewer" };
const TABS = [["all", "All"], ["action", "Action needed"], ["money", "Money"], ["piracy", "Piracy"], ["reviews", "Reviews"], ["team", "Team"]] as const;

function words(n: Notice): { title: string; detail: string; tone: string; href?: string; button?: string } {
  const film = n.film || "your film";
  switch (n.type) {
    case "leak_open": return { title: `Leak found: ${film} ${KINDS[n.lang] ?? "copy"} on ${PLACES[n.text] ?? "the web"}`, detail: "Send a takedown notice, allow it, or ask E-Cinema to close the account.", tone: "red", href: "/studio/piracy", button: "View case" };
    case "leak_down": return { title: `Leak taken down: ${film}`, detail: `The copy on ${PLACES[n.text] ?? "the web"} is gone.`, tone: "green", href: "/studio/piracy" };
    case "leak_banned": return { title: `Account closed after a leak of ${film}`, detail: "E-Cinema checked the copy and closed the account that shared it.", tone: "green", href: "/studio/piracy" };
    case "leak_noted": return { title: `Leak of ${film} updated`, detail: `On ${PLACES[n.text] ?? "the web"}.`, tone: "amber", href: "/studio/piracy" };
    case "dub_review": return { title: `Review the ${dubName(n.lang)} dub of ${film}`, detail: "Studio AI translated it; read the lines, then approve it to voice.", tone: "amber", href: `/studio/dubs?film=${n.ref}&lang=${n.lang}`, button: "Review" };
    case "dub_failed": return { title: `The ${dubName(n.lang)} dub of ${film} failed`, detail: "Open it to see why and try again.", tone: "red", href: `/studio/dubs?film=${n.ref}&lang=${n.lang}`, button: "Open" };
    case "dub_approved": return { title: `${dubName(n.lang)} dub of ${film} approved`, detail: "Viewers can pick it in the watch room.", tone: "green", href: `/studio/dubs?film=${n.ref}&lang=${n.lang}` };
    case "upload_failed": return { title: `Upload failed: ${n.text}`, detail: `Part of ${film}. Choose the file again to carry on.`, tone: "red", href: `/studio/upload/${n.ref}`, button: "Upload" };
    case "on_sale": return { title: `${film} is on sale`, detail: "The premiere is published and seats can be bought.", tone: "teal", href: `/film/${n.ref}` };
    case "on_sale_soon": return { title: `${film} is on Coming soon`, detail: "Early seats are on sale at the early-bird price.", tone: "teal", href: `/preorder/${n.ref}` };
    case "payout_sent": return { title: `Payout of ${money(n.num, n.currency || "USD")} sent`, detail: `${film}, your 70% share.`, tone: "teal", href: "/studio/payouts" };
    case "payout_failed": return { title: `Payout for ${film} failed`, detail: "Check your payout account in Settings; we try again after you fix it.", tone: "red", href: "/studio/settings", button: "Settings" };
    case "review": return { title: `New ${n.num}-star review of ${film}`, detail: n.text ? `“${n.text.slice(0, 140)}${n.text.length > 140 ? "…" : ""}”` : "No words, just stars.", tone: "purple" };
    case "member_added": return { title: `${n.text} joined the team`, detail: `Added as ${ROLES[n.lang] ?? n.lang}.`, tone: "blue", href: "/studio/team" };
  }
  return { title: film, detail: "", tone: "grey" };
}

function ago(iso: string, now: number) {
  const m = Math.max(0, Math.round((now - Date.parse(iso)) / 60000));
  if (m < 60) return `${Math.max(1, m)} min`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h`;
  const d = Math.round(h / 24);
  return d === 1 ? "Yesterday" : `${d} days`;
}

export default function StudioNotices({ initial, failed }: { initial: NoticeData; failed: boolean }) {
  const [d, setD] = useState(initial);
  const [tab, setTab] = useState<(typeof TABS)[number][0]>("all");
  const [now, setNow] = useState(0);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  useEffect(() => { const t = setTimeout(() => setNow(Date.now()), 0); return () => clearTimeout(t); }, []);

  const seen = d.seenAt ? Date.parse(d.seenAt) : 0;
  const shown = d.notices.filter((n) => tab === "all" || (tab === "action" ? n.action : n.group === tab));
  async function markRead() {
    setBusy(true); setErr("");
    try { await scall("POST", "notices/seen"); setD(await scall<NoticeData>("GET", "notices")); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }

  return (
    <div className="pt-body stnt">
      <header className="bp-head">
        <div>
          <h1>Notifications</h1>
          <p>Everything that needs your studio&rsquo;s attention</p>
        </div>
        <div className="pt-btns">
          <button type="button" className="vf-btn ghost" disabled={busy || !d.unread} onClick={markRead}>{busy ? "Marking" : "Mark all read"}</button>
          <span className="vf-btn soft stu-soon" aria-disabled="true" title="Coming soon">Notification settings <em className="soon-tag">Soon</em></span>
        </div>
      </header>
      {failed && <p className="vf-err" role="alert">Your notifications could not be loaded just now. Refresh the page to try again.</p>}
      {err && <p className="vf-err" role="alert">{err}</p>}
      <nav className="bp-chips" aria-label="Show">
        {TABS.map(([id, label]) => (
          <button key={id} type="button" className={tab === id ? "on" : ""} aria-pressed={tab === id} onClick={() => setTab(id)}>{label}{id === "action" && d.action ? ` ${d.action}` : ""}</button>
        ))}
      </nav>
      {shown.length ? (
        <ul className="stnt-list">
          {shown.map((n) => {
            const w = words(n);
            const unread = !seen || Date.parse(n.at) > seen;
            return (
              <li key={n.id} className={unread ? "new" : ""}>
                <i className={`dot ${w.tone}`} aria-hidden />
                <div className="txt">
                  <b>{w.title}</b>
                  {w.detail && <small>{w.detail}</small>}
                </div>
                <span className="when">{now ? ago(n.at, now) : ""}</span>
                {w.href && (w.button
                  ? <Link className="vf-btn soft sm" href={w.href}>{w.button}</Link>
                  : <Link className="stnt-open" href={w.href} aria-label={`Open: ${w.title}`}>›</Link>)}
              </li>
            );
          })}
        </ul>
      ) : (
        <section className="bp-panel"><p className="pt-hint">{d.notices.length ? "Nothing here." : "Nothing yet. Leaks, dubs to review, payouts, reviews and team changes show up here."}</p></section>
      )}
    </div>
  );
}
