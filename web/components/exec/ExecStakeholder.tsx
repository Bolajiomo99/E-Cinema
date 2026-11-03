"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { StakeholderData } from "@/lib/exec";

// Stakeholder view (Figma 83:958). Read only for stakeholders; the CEO writes the message,
// shares PDFs and posts milestones (on the investor view, shared by both pages).
const M = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const day = (iso: string) => { const d = new Date(Date.parse(iso) + 3600_000); return `${d.getUTCDate()} ${M[d.getUTCMonth()]}`; };
const round = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e4 ? `${Math.round(n / 1e3)}K` : n >= 1000 ? `${(n / 1e3).toFixed(1)}K` : `${n}`);
const usd = (c: number) => `$${round(Math.round(c / 100))}`;
const pct = (now: number, before: number) => (before > 0 ? Math.round(((now - before) / before) * 100) : null);

export default function ExecStakeholder({ d, revenue, revenuePrev, viewer }: { d: StakeholderData; revenue: number; revenuePrev: number; viewer: string }) {
  const router = useRouter();
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const mg = pct(d.members, d.membersStart);
  const rg = pct(revenue, revenuePrev);
  const ahead = d.milestones.filter((m) => !m.done).slice(0, 3);
  const done = d.milestones.filter((m) => m.done).slice(-3);

  async function saveNote() {
    setBusy(true); setErr("");
    const r = await fetch("/api/executive/stakeholder/note", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ body: note }) }).catch(() => null);
    const b = (await r?.json().catch(() => ({}))) as { error?: string };
    setBusy(false);
    if (!r?.ok) { setErr(b.error ?? "Could not save"); return; }
    setNote(null); router.refresh();
  }
  async function upload(f: File) {
    setBusy(true); setErr("");
    const form = new FormData(); form.set("file", f);
    const r = await fetch("/api/executive/stakeholder/docs", { method: "POST", body: form }).catch(() => null);
    const b = (await r?.json().catch(() => ({}))) as { error?: string };
    setBusy(false);
    if (!r?.ok) { setErr(b.error ?? "Could not share the file"); return; }
    router.refresh();
  }
  async function remove(id: string) {
    setBusy(true);
    await fetch(`/api/executive/stakeholder/docs/${id}`, { method: "DELETE" }).catch(() => null);
    setBusy(false); router.refresh();
  }

  return (
    <section className="exc exinv">
      {viewer && <div className="exinv-wm" aria-hidden="true">{Array.from({ length: 24 }, (_, i) => <span key={i}>{viewer}</span>)}</div>}
      <header className="exc-head">
        <div>
          <h1>E-Cinema this month</h1>
          <p className="exc-sub">A short summary the CEO shares with stakeholders. Read only; numbers are rounded and nothing personal is shown.</p>
        </div>
        <div className="epf-acts exinv-noprint"><button type="button" className="exa-ghost" onClick={() => window.print()}>Download PDF</button></div>
      </header>

      <div className="exc-tiles exg-tiles">
        <div className="exc-tile"><span>Members</span><b>{round(d.members)}</b><small className={mg !== null && mg < 0 ? "down" : "up"}>{mg === null ? "first month" : `${mg >= 0 ? "▲" : "▼"} ${Math.abs(mg)}% this month`}</small></div>
        <div className="exc-tile"><span>Revenue</span><b>{usd(revenue)}</b><small className={rg !== null && rg < 0 ? "down" : "up"}>{rg === null ? "this month so far" : `${rg >= 0 ? "▲" : "▼"} ${Math.abs(rg)}% on last month`}</small></div>
        <div className="exc-tile"><span>Countries</span><b>{d.countries}</b><small>where members live</small></div>
        <div className="exc-tile"><span>Uptime</span><b className="exin-soon">Soon</b><small>needs the UptimeRobot key</small></div>
      </div>

      <div className="exc-row exinv-row">
        <div className="exc-card">
          <h2>Milestones</h2>
          {done.length + ahead.length === 0 && <p className="exc-empty">No milestones posted yet.</p>}
          {[...done, ...ahead].map((m) => (
            <div key={m.id} className="exstk-ms"><i className={`exsec-pill ${m.done ? "ok" : "warn"}`}>{m.done ? "Done" : "Next"}</i><span>{m.title}</span><small>{m.quarter}</small></div>
          ))}
          {d.canEdit && <p className="epf-hint exinv-noprint">Milestones are added on the <a href="/executive/investor">investor view</a>.</p>}
        </div>
        <div className="exc-card">
          <h2>Message from the CEO</h2>
          {note === null ? (
            <>
              {d.note ? <p className="exstk-note">{d.note}</p> : <p className="exc-empty">{d.canEdit ? "Write this month's message for stakeholders." : "No message this month yet."}</p>}
              {d.note && <p className="exstk-by">Bolaji, CEO{d.noteAt ? ` · ${day(d.noteAt)}` : ""}</p>}
              {d.canEdit && <button type="button" className="exa-ghost exinv-noprint" onClick={() => setNote(d.note)}>{d.note ? "Edit message" : "Write message"}</button>}
            </>
          ) : (
            <>
              <textarea className="exstk-ta" rows={5} maxLength={1200} value={note} onChange={(e) => setNote(e.target.value)} aria-label="Message to stakeholders" />
              <div className="epf-acts"><button type="button" className="exa-ghost" onClick={() => setNote(null)}>Cancel</button><button type="button" className="exa-red" disabled={busy} onClick={saveNote}>Save</button></div>
            </>
          )}
        </div>
      </div>

      <div className="exc-card">
        <h2>Documents shared with you</h2>
        {d.docs.length === 0 && <p className="exc-empty">Nothing shared yet.</p>}
        {d.docs.map((x) => (
          <div key={x.id} className="exstk-doc">
            <a href={`/api/executive/stakeholder/docs/${x.id}`} target="_blank" rel="noreferrer">{x.name}</a>
            <small>Shared {day(x.sharedAt)}</small>
            {d.canEdit && <button type="button" className="exsec-link exinv-noprint" disabled={busy} onClick={() => remove(x.id)}>Remove</button>}
          </div>
        ))}
        {d.canEdit && (
          <label className="exa-ghost exstk-up exinv-noprint">
            {busy ? "Working…" : "Share a PDF"}
            <input type="file" accept="application/pdf" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = ""; }} />
          </label>
        )}
        {err && <p className="epf-err" role="alert">{err}</p>}
      </div>
    </section>
  );
}
