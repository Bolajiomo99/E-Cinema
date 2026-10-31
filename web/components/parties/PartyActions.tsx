"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

type Props = {
  code: string; link: string; film: string; signedIn: boolean; joined: boolean; isHost: boolean; inviteOnly: boolean;
  invited: string[]; ended: boolean; seat: boolean; roomOpen: boolean; showtimeId: string; signinHref: string;
};

export default function PartyActions(p: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState("");
  const [copied, setCopied] = useState(false);
  const [emails, setEmails] = useState("");

  const act = async (action: string, body?: unknown) => {
    setBusy(action);
    setMsg("");
    const r = await fetch(`/api/parties/${p.code}/${action}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body ?? {}) });
    const b = await r.json().catch(() => ({}));
    setBusy("");
    if (!r.ok) return setMsg(b.error ?? "Something went wrong. Try again.");
    if (action === "end") return router.push("/home");
    if (action === "invites") { setEmails(""); setMsg(b.emailed ? `Invited and emailed ${b.emailed}.` : "Added to the invite list."); }
    router.refresh();
  };
  const copy = async () => {
    try {
      if (navigator.share && /Mobi|Android/i.test(navigator.userAgent)) await navigator.share({ title: `Watch ${p.film} with me on E-Cinema`, url: p.link });
      else { await navigator.clipboard.writeText(p.link); setCopied(true); setTimeout(() => setCopied(false), 2500); }
    } catch {}
  };

  return (
    <div className="party-acts">
      <div className="wp-field">
        <span>Party link</span>
        <div className="wp-link">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden><path d="M10 13a5 5 0 0 0 7.07 0l3-3a5 5 0 0 0-7.07-7.07l-1 1M14 11a5 5 0 0 0-7.07 0l-3 3a5 5 0 0 0 7.07 7.07l1-1" /></svg>
          <input readOnly value={p.link.replace(/^https?:\/\//, "")} aria-label="Party link" onFocus={(e) => e.currentTarget.select()} />
          <button type="button" onClick={copy}>{copied ? "Copied" : "Copy"}</button>
        </div>
      </div>

      {p.isHost && p.inviteOnly && !p.ended && (
        <div className="wp-field">
          <span>Invite list{p.invited.length ? ` · ${p.invited.length}` : ""}</span>
          {p.invited.length > 0 && <div className="wp-emails">{p.invited.map((e) => <span key={e} className="wp-email static">{e}</span>)}</div>}
          <div className="wp-link">
            <input placeholder="Add emails, separated by commas" value={emails} onChange={(e) => setEmails(e.target.value)} aria-label="Add emails" />
            <button type="button" disabled={!emails.trim() || busy === "invites"} onClick={() => act("invites", { emails: emails.split(/[\s,;]+/).filter(Boolean) })}>{busy === "invites" ? "Adding…" : "Invite"}</button>
          </div>
        </div>
      )}

      {msg && <p className="wp-err" role="status">{msg}</p>}

      {p.ended ? (
        <p className="party-sub">This premiere has ended. <Link href="/releases">See what is on next</Link>.</p>
      ) : !p.signedIn ? (
        <Link href={p.signinHref} className="lp-btn lg wp-cta">Sign in to join the party</Link>
      ) : !p.joined ? (
        <button type="button" className="lp-btn lg wp-cta" disabled={busy === "join"} onClick={() => act("join")}>{busy === "join" ? "Joining…" : "Join the party"}</button>
      ) : p.seat ? (
        p.roomOpen ? <Link href={`/room/${p.showtimeId}`} className="lp-btn lg wp-cta">Go to the room</Link>
          : <p className="party-ok">You have a seat. The room opens 30 minutes before the premiere, and your party watches together there.</p>
      ) : (
        <Link href={`/checkout?film=${p.showtimeId}`} className="lp-btn lg wp-cta">Get your seat</Link>
      )}

      {p.joined && !p.ended && (
        <div className="party-foot">
          {p.isHost
            ? <button type="button" className="st-link" disabled={busy === "end"} onClick={() => confirm("End this party for everyone?") && act("end")}>End party</button>
            : <button type="button" className="st-link" disabled={busy === "leave"} onClick={() => act("leave")}>Leave party</button>}
        </div>
      )}
    </div>
  );
}
