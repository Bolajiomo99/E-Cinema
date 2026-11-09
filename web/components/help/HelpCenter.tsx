"use client";

import { useState } from "react";
import Link from "next/link";
import Logo from "@/components/landing/Logo";
import ConciergeChat from "@/components/ai/ConciergeChat";

// Help and AI concierge (Figma 33:987). The search box and the topics ask E-Cinema AI on the
// right; "Message our team" (the support inbox) reaches a person, who answers by email.
const I = { width: 22, height: 22, viewBox: "0 0 24 24", fill: "none", stroke: "#e3182d", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true } as const;
const ICONS: Record<string, React.ReactNode> = {
  payments: <svg {...I}><rect x="2.5" y="5" width="19" height="14" rx="2" /><path d="M2.5 10h19" /></svg>,
  playback: <svg {...I}><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M7 3v18M17 3v18M3 8h4M3 16h4M17 8h4M17 16h4M3 12h18" /></svg>,
  languages: <svg {...I}><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" /></svg>,
  account: <svg {...I}><path d="M12 3l7 3v5c0 5-3 8.5-7 10-4-1.5-7-5-7-10V6z" /></svg>,
  kids: <svg {...I}><circle cx="12" cy="8" r="4" /><path d="M5 21a7 7 0 0 1 14 0" /></svg>,
  country: <svg {...I}><path d="M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2z" /><path d="M9 4v14M15 6v14" /></svg>,
};
export type HelpTopic = { id: string; label: string };
export type HelpStatus = { up: boolean | null; liveRooms: number };

const SUGGEST = ["I was charged but have no ticket", "The film keeps buffering", "How do I switch the audio language?", "I want to talk to a person"];

export default function HelpCenter({ topics, status, signedIn, email }: { topics: HelpTopic[]; status: HelpStatus; signedIn: boolean; email: string }) {
  const [prompt, setPrompt] = useState<{ text: string; n: number }>({ text: "", n: 0 });
  const [q, setQ] = useState("");
  const askAI = (text: string) => {
    if (!text.trim()) return;
    setPrompt((p) => ({ text: text.trim(), n: p.n + 1 }));
    document.getElementById("hc-ai")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  // Message our team (support inbox).
  const [topic, setTopic] = useState("other");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [from, setFrom] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState<{ id: number; link: string } | null>(null);
  const [err, setErr] = useState("");
  async function send(e: React.FormEvent) {
    e.preventDefault();
    setErr(""); setSending(true);
    const r = await fetch("/api/support", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ topic, subject, body, email: from }) }).catch(() => null);
    const b = (await r?.json().catch(() => ({}))) as { id?: number; link?: string; error?: string };
    setSending(false);
    if (!r?.ok || !b.id || !b.link) { setErr(b.error ?? "We could not send that. Please try again."); return; }
    setSent({ id: b.id, link: b.link });
  }

  const statusText = [
    status.up === null ? "" : status.up ? "All systems normal" : "Some services are slow right now",
    `${status.liveRooms} live room${status.liveRooms === 1 ? "" : "s"}`,
  ].filter(Boolean).join(" · ");

  return (
    <div className="hc">
      <main id="main" className="hc-help">
        <Logo />
        <h1>How can we help?</h1>
        <form className="hc-search" role="search" onSubmit={(e) => { e.preventDefault(); askAI(q); setQ(""); }}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#a6a6b0" strokeWidth="1.8" strokeLinecap="round" aria-hidden><circle cx="11" cy="11" r="7" /><path d="M20 20l-4-4" /></svg>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search help, or ask in any language" aria-label="Search help, or ask in any language" maxLength={400} />
        </form>
        <div className="hc-topics">
          {topics.map((t) => (
            <button key={t.id} type="button" className="hc-topic" onClick={(e) => { askAI(`I need help with: ${(e.currentTarget.textContent ?? t.label).trim()}`); setTopic(t.id); }}>
              {ICONS[t.id]}<span>{t.label}</span>
            </button>
          ))}
        </div>
        <p className={`hc-status${status.up === false ? " warn" : ""}`}><i aria-hidden />{statusText}</p>

        <section className="hc-team" aria-labelledby="hc-team-h">
          <div className="hc-team-head">
            <h2 id="hc-team-h">Message our team</h2>
            {signedIn && <Link href="/help/requests">My requests</Link>}
          </div>
          <p className="hc-sub">A person reads every message and answers by email{signedIn ? ` at ${email}` : ""}. For a paid seat you can also <Link href="/help/refund">ask for a refund</Link> straight away.</p>
          {sent ? (
            <div className="hc-sent" role="status">
              <b>Sent. Your request number is #{sent.id}.</b>
              <span>We emailed you a copy. You can read the answer and reply on <Link href={sent.link}>your request page</Link>.</span>
            </div>
          ) : (
            <form className="hc-form" onSubmit={send}>
              <label>Topic
                <select value={topic} onChange={(e) => setTopic(e.target.value)}>
                  {topics.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
                  <option value="other">Something else</option>
                </select>
              </label>
              {!signedIn && <label>Your email<input type="email" required value={from} onChange={(e) => setFrom(e.target.value)} autoComplete="email" maxLength={254} /></label>}
              <label className="wide">Subject<input required value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={140} placeholder="For example: charged twice for Red Earth" /></label>
              <label className="wide">Message<textarea required value={body} onChange={(e) => setBody(e.target.value)} maxLength={5000} rows={5} placeholder="What happened, which film and when, and what you would like us to do" /></label>
              {err && <p className="hc-err" role="alert">{err}</p>}
              <button className="lp-btn" disabled={sending || !subject.trim() || !body.trim()}>{sending ? "Sending…" : "Send to the team"}</button>
            </form>
          )}
        </section>
      </main>

      <aside className="hc-panel" id="hc-ai" aria-label="E-Cinema AI">
        <header>
          <span className="hc-orb" aria-hidden>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#d4a23a" strokeWidth="2" strokeLinecap="round"><path d="M12 2v4M12 18v4M4.9 4.9l2.8 2.8M16.3 16.3l2.8 2.8M2 12h4M18 12h4M4.9 19.1l2.8-2.8M16.3 7.7l2.8-2.8" /></svg>
          </span>
          <div><strong>E-Cinema AI</strong><span>Speaks your language · can book seats and pass you to our team</span></div>
        </header>
        <ConciergeChat compact mic prompt={prompt} placeholder="Type or hold the mic to talk" suggestions={SUGGEST} />
      </aside>
    </div>
  );
}
