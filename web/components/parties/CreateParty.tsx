"use client";

import { useState } from "react";
import { RULES } from "@/lib/parties";

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

// "Start a watch party" from Figma 31:934. Friends lists and shared payment are marked Soon
// until those features exist; link and invite-only parties work today.
export default function CreateParty({ showtimeId, defaultName }: { showtimeId: string; defaultName: string }) {
  const [name, setName] = useState(defaultName);
  const [vis, setVis] = useState<"link" | "invite">("link");
  const [rules, setRules] = useState<string[]>(["voice-notes", "spoiler-filter", "translate-chat"]);
  const [draft, setDraft] = useState("");
  const [emails, setEmails] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const addEmails = (text: string) => {
    const found = text.split(/[\s,;]+/).map((e) => e.trim().toLowerCase()).filter(Boolean);
    const bad = found.find((e) => !EMAIL.test(e));
    if (bad) return setError(`"${bad}" is not an email address`);
    setError("");
    setEmails((cur) => [...new Set([...cur, ...found])].slice(0, 50));
    setDraft("");
  };
  const toggle = (r: string) => setRules((cur) => (cur.includes(r) ? cur.filter((x) => x !== r) : [...cur, r]));

  async function create() {
    const pending = draft.trim() ? draft.split(/[\s,;]+/).filter(Boolean) : [];
    if (pending.some((e) => !EMAIL.test(e))) return setError("Check the email addresses");
    const invite = [...new Set([...emails, ...pending.map((e) => e.toLowerCase())])];
    if (vis === "invite" && !invite.length) return setError("Add at least one email for an invite-only party");
    setBusy(true);
    setError("");
    const r = await fetch("/api/parties", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ showtimeId, name, visibility: vis, rules, invite }) });
    const b = await r.json().catch(() => ({}));
    if (!r.ok) { setBusy(false); return setError(b.error ?? "Could not create the party. Try again."); }
    window.location.assign(`/p/${b.code}?new=1${b.emailed ? `&emailed=${b.emailed}` : ""}`);
  }

  const n = emails.length + (draft.trim() ? draft.split(/[\s,;]+/).filter(Boolean).length : 0);
  return (
    <div className="wp-form">
      <label className="wp-field">
        <span>Party name</span>
        <input value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
      </label>
      <div className="wp-field">
        <span>Who can join</span>
        <div className="wp-chips" role="radiogroup" aria-label="Who can join">
          <button type="button" className="wp-chip" disabled title="Friends lists are coming soon">Friends <em>Soon</em></button>
          <button type="button" role="radio" aria-checked={vis === "link"} className={`wp-chip${vis === "link" ? " on" : ""}`} onClick={() => setVis("link")}>Anyone with link</button>
          <button type="button" role="radio" aria-checked={vis === "invite"} className={`wp-chip${vis === "invite" ? " on" : ""}`} onClick={() => setVis("invite")}>Invite only</button>
        </div>
      </div>
      <div className="wp-field">
        <span>Seats</span>
        <div className="wp-chips">
          <button type="button" className="wp-chip on" aria-pressed="true">Everyone pays</button>
          <button type="button" className="wp-chip" disabled title="Paying for the whole group is coming soon">I pay for all <em>Soon</em></button>
          <button type="button" className="wp-chip" disabled title="Splitting the bill is coming soon">Split evenly <em>Soon</em></button>
        </div>
      </div>
      <div className="wp-field">
        <span>Invite {vis === "link" ? "(optional)" : ""}</span>
        {emails.length > 0 && (
          <div className="wp-emails">
            {emails.map((e) => <button key={e} type="button" className="wp-email" onClick={() => setEmails((c) => c.filter((x) => x !== e))} aria-label={`Remove ${e}`}>{e} ×</button>)}
          </div>
        )}
        <div className="wp-link">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden><path d="M4 4h16v16H4z" opacity="0" /><path d="m4 7 8 6 8-6M4 6h16v12H4z" /></svg>
          <input placeholder="Friends' emails, separated by commas" value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === ",") { e.preventDefault(); if (draft.trim()) addEmails(draft); } }} aria-label="Invite by email" />
          <button type="button" onClick={() => draft.trim() && addEmails(draft)}>Add</button>
        </div>
        <small className="wp-help">{vis === "invite" ? "Only these emails can join, after they sign in." : "Everyone with the party link can join. You get the link next."}</small>
      </div>
      <div className="wp-field">
        <span>Room rules</span>
        <div className="wp-chips wrap">
          {RULES.map(([k, l]) => <button key={k} type="button" aria-pressed={rules.includes(k)} className={`wp-chip${rules.includes(k) ? " on" : ""}`} onClick={() => toggle(k)}>{l}</button>)}
        </div>
      </div>
      {error && <p className="wp-err" role="alert">{error}</p>}
      <button type="button" className="lp-btn lg wp-cta" disabled={busy || !name.trim()} onClick={create}>{busy ? "Creating…" : n ? `Create party and invite ${n}` : "Create party"}</button>
    </div>
  );
}
