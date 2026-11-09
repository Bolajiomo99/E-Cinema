"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { AutoFlags, SafetyData, Verdict } from "@/lib/exec";
import { countryName } from "@/lib/worldmap";

// Safety and trust (Figma 82:1075). Claude gives a hint on each reported message; a person decides.
const REASON: Record<string, string> = { harassment: "Insult or harassment", hate: "Hate speech", spoilers: "Spoilers", spam: "Spam or seller link", recording: "Says they are recording", under13: "May be under 13", other: "Something else" };
const PLACE: Record<string, string> = { website: "Website", telegram: "Telegram channel", tiktok: "TikTok", youtube: "YouTube", x: "X", instagram: "Instagram", facebook: "Facebook", whatsapp: "WhatsApp", other: "Elsewhere" };
const KIND: Record<string, string> = { clip: "clip", full: "full film", screenshot: "screenshot", other: "copy" };
const BAD = new Set(["abusive", "hateful", "unsafe"]);
const FLAG: Record<string, string> = { abusive: "Abuse", hateful: "Hate", sexual: "Sexual", threat: "Threat", selfharm: "May hurt themselves", spam: "Spam", scam: "Scam", piracy: "Pirated film" };
const SOURCE: Record<string, string> = { room: "World chat", post: "Post", comment: "Comment" };

export default function ExecSafety({ d, ai, auto }: { d: SafetyData; ai: Record<string, Verdict>; auto: AutoFlags | null }) {
  const router = useRouter();
  const [busy, setBusy] = useState<number | null>(null);
  const [done, setDone] = useState<Record<number, string>>({});
  const [err, setErr] = useState("");
  const [flagDone, setFlagDone] = useState<Record<string, string>>({});
  const settled = d.reportsToday ? Math.round((d.settledToday / d.reportsToday) * 100) : 0;
  const signals: [string, number, string][] = [
    ["Wrong passwords (locked out)", d.lockouts, "#e3182d"],
    ["Refunds 3+ times in 90 days", d.refundRepeats, "#e8a33b"],
    ["Accounts closed for sharing films", d.banned, "#e3182d"],
    ["Reported as under 13", d.under13, "#e8a33b"],
  ];
  const most = Math.max(1, ...signals.map((x) => x[1]));

  async function settle(showtimeId: string, messageId: number, remove: boolean) {
    setErr(""); setBusy(messageId);
    const r = await fetch(`/api/executive/safety/${showtimeId}/${messageId}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ remove }) }).catch(() => null);
    const b = (await r?.json().catch(() => ({}))) as { error?: string };
    setBusy(null);
    if (!r?.ok) { setErr(b.error ?? "Could not settle that report"); return; }
    setDone((x) => ({ ...x, [messageId]: remove ? "Removed for everyone" : "Kept" }));
    router.refresh();
  }

  async function review(source: string, id: number, remove: boolean) {
    const k = `${source}-${id}`;
    setErr(""); setBusy(-id);
    const r = await fetch(`/api/executive/auto-flags/${source}/${id}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ remove }) }).catch(() => null);
    const b = (await r?.json().catch(() => ({}))) as { error?: string };
    setBusy(null);
    if (!r?.ok) { setErr(b.error ?? "Could not settle that flag"); return; }
    setFlagDone((x) => ({ ...x, [k]: remove ? "Hidden for everyone" : "Put back" }));
    router.refresh();
  }

  return (
    <section className="exc exf">
      <header className="exc-head">
        <div>
          <h1>Safety and trust</h1>
          <p className="exc-sub">Moderation, account abuse and piracy in one place. AI gives a hint on each report; a person decides.</p>
        </div>
        <Link href="/legal/community" className="exa-ghost exn-btn">Safety policy</Link>
      </header>

      <div className="exc-tiles exg-tiles">
        <div className="exc-tile"><span>Reports today</span><b>{d.reportsToday.toLocaleString("en-US")}</b><small className="up">{d.reportsToday ? `${settled}% settled` : "none yet today"}{d.openReports ? ` · ${d.openReports} waiting` : ""}</small></div>
        <div className="exc-tile"><span>Capture attempts blocked</span><b className="exl-soon exf-soon">Soon</b><small>screen record, HDMI and bot detection</small></div>
        <div className="exc-tile"><span>Duplicate accounts stopped</span><b className="exl-soon exf-soon">Soon</b><small>face match at sign-up</small></div>
        <div className="exc-tile"><span>Leaks taken down</span><b>{d.leaksDown}</b><small className="up">{d.leaksDown ? `avg ${d.avgTakedownMin} min to takedown · 30 days` : "none in 30 days"}</small></div>
      </div>

      <div className="exc-row exf-row">
        <div className="exc-card">
          <h2>Needs a person</h2>
          {err && <p className="epf-err" role="alert">{err}</p>}
          {d.queue.length === 0 && <p className="exc-empty">No open reports. Messages three people report are hidden straight away and wait here.</p>}
          {d.queue.map((c) => {
            const v = ai[c.messageId];
            const tone = !v ? "" : v.label === "fine" ? "ok" : v.label === "unsure" || !BAD.has(v.label) ? "mid" : "bad";
            return (
              <div key={c.messageId} className="exf-case">
                <div className="exf-txt">
                  <b>{c.kind === "text" ? `“${c.body}”` : `${c.kind === "voice" ? "Voice note" : c.kind === "image" ? "Photo" : "File"} in chat`}</b>
                  <small>{REASON[c.reason] ?? c.reason} · reported by {c.reporters} viewer{c.reporters === 1 ? "" : "s"} · {c.film}{c.country ? ` · ${countryName(c.country)}` : ""}{c.hidden ? " · hidden for now" : ""}</small>
                </div>
                {v && <span className={`exf-ai ${tone}`}>AI: {v.label === "unsure" ? "unsure" : `${v.pct}% ${v.label}`}</span>}
                {done[c.messageId] ? <span className="exf-done">{done[c.messageId]}</span> : (
                  <span className="exf-acts">
                    <button type="button" className="exa-ghost" disabled={busy === c.messageId} onClick={() => settle(c.showtimeId, c.messageId, false)}>Keep</button>
                    <button type="button" className="exa-edit exf-rm" disabled={busy === c.messageId} onClick={() => settle(c.showtimeId, c.messageId, true)}>Remove</button>
                  </span>
                )}
              </div>
            );
          })}
          <p className="epf-hint">Brand reports are settled on the <Link href="/rewards/desk">rewards desk</Link>; leak bans on the <Link href="/studio/desk">studio desk</Link>.</p>
        </div>
        <div className="exc-card">
          <h2>Account signals</h2>
          {signals.map(([label, n, color]) => (
            <div key={label} className="exf-sig"><span>{label}</span><i><em style={{ width: `${(n / most) * 100}%`, background: color }} /></i><b>{n.toLocaleString("en-US")}</b></div>
          ))}
          <div className="exf-sig off"><span>Shared logins</span><small className="exl-soon">Soon</small></div>
          <div className="exf-sig off"><span>Card testing</span><small className="exl-soon">Soon</small></div>
          <div className="exf-sig off"><span>VPN to a cheaper country</span><small className="exl-soon">Soon</small></div>
          <p className="epf-hint">Each account can be signed in on two devices; a third signs out the oldest.</p>
        </div>
      </div>

      <div className="exc-card exl-card" id="auto">
        <h2>Caught automatically</h2>
        <p className="exc-sub">AI reads every new world-chat message, community post and comment. It hides what it is {auto?.hideAt ?? 85}% or more sure breaks the rules, and lists the rest here. Private messages and party chat are not read.{auto ? ` ${auto.today.toLocaleString("en-US")} flagged today.` : ""}</p>
        {!auto ? <p className="exc-empty">Could not load the automatic flags.</p> : auto.flags.length === 0 ? <p className="exc-empty">Nothing is waiting. New flags show here within a minute.</p> : auto.flags.map((f) => {
          const k = `${f.source}-${f.id}`;
          return (
            <div key={k} className="exf-case">
              <div className="exf-txt">
                <b translate="no">“{f.body}”</b>
                <small>{SOURCE[f.source]}{f.place ? ` · ${f.place}` : ""} · {f.hidden ? "hidden for now" : "still showing"}</small>
              </div>
              <span className={`exf-ai ${f.label === "selfharm" ? "mid" : "bad"}`}>AI: {f.pct}% {FLAG[f.label] ?? f.label}</span>
              {flagDone[k] ? <span className="exf-done">{flagDone[k]}</span> : (
                <span className="exf-acts">
                  <button type="button" className="exa-ghost" disabled={busy === -f.id} onClick={() => review(f.source, f.id, false)}>{f.hidden ? "Put back" : "Keep"}</button>
                  <button type="button" className="exa-edit exf-rm" disabled={busy === -f.id} onClick={() => review(f.source, f.id, true)}>{f.hidden ? "Keep hidden" : "Hide"}</button>
                </span>
              )}
            </div>
          );
        })}
        <p className="epf-hint">When someone writes that they may hurt themselves, the message stays up and waits here so a person can reach out.</p>
      </div>

      <div className="exc-card exl-card">
        <h2>Piracy watch</h2>
        {d.leaks.length === 0 ? <p className="exc-empty">No leaks reported yet. Studios report them from their piracy page.</p> : (
          <div className="exn-table" role="table" tabIndex={0} aria-label="Piracy watch">
            <div className="exn-th exf-g" role="row"><span role="columnheader">Where</span><span role="columnheader">Film</span><span role="columnheader">Found by</span><span role="columnheader">Status</span></div>
            {d.leaks.map((l, i) => (
              <div key={i} className="exn-tr exf-g" role="row">
                <span role="cell">{PLACE[l.place] ?? l.place}, {KIND[l.kind] ?? l.kind}</span>
                <span role="cell">{l.film || "–"}</span>
                <span role="cell">{l.traced ? "Studio report, viewer code traced" : "Studio report"}</span>
                <span role="cell"><i className={`exf-st ${l.status}`}>{l.status === "taken_down" ? (l.mins ? `Taken down in ${l.mins < 120 ? `${l.mins} min` : `${Math.round(l.mins / 60)} h`}` : "Taken down") : l.status === "takedown_sent" ? "Notice sent" : l.status === "allowed" ? "Allowed" : "Open"}</i></span>
              </div>
            ))}
          </div>
        )}
        <p className="epf-hint">Watermark and audio fingerprint crawlers that find leaks on their own <span className="exl-soon">Soon</span></p>
      </div>
    </section>
  );
}
