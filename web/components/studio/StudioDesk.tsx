"use client";
import { useCallback, useEffect, useState } from "react";
import { nameOf } from "@/lib/countries";
import { dayName, type Studio } from "@/lib/studio-types";
import { scall } from "./scall";

// Staff review of studio applications: papers, payout account, rights, then approve or send back.
type Row = Studio & { doc?: string };
type Ban = { id: string; studio: string; film: string; kind: string; place: string; link: string; what: string; code: string; createdAt: string; accountId: string; email: string; name: string; banned: boolean };
const PILL: Record<string, string> = { submitted: "amber", verified: "teal", rejected: "red", draft: "grey" };

export default function StudioDesk() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const [bans, setBans] = useState<Ban[]>([]);
  const load = useCallback(() => Promise.all([
    scall<{ studios: Row[] }>("GET", "desk").then((r) => setRows(r.studios)),
    scall<{ requests: Ban[] | null }>("GET", "desk/bans").then((r) => setBans(r.requests ?? [])),
  ]).catch((e) => setErr((e as Error).message)), []);
  useEffect(() => { load(); }, [load]);

  async function review(slug: string, approve: boolean) {
    setBusy(slug); setErr("");
    try { await scall("POST", `desk/${slug}`, { approve, note: notes[slug] ?? "" }); await load(); } catch (e) { setErr((e as Error).message); } finally { setBusy(""); }
  }

  async function decide(id: string, approve: boolean) {
    setBusy(id); setErr("");
    try { await scall("POST", `desk/bans/${id}`, { approve }); await load(); } catch (e) { setErr((e as Error).message); } finally { setBusy(""); }
  }

  const waiting = rows?.filter((r) => r.status === "submitted") ?? [];
  const rest = rows?.filter((r) => r.status !== "submitted") ?? [];
  return (
    <div className="bp-desk">
      <header className="bp-head"><div><h1>Studio desk</h1><p>New studios wait here until someone checks their papers and rights.</p></div></header>
      {err && <p className="vf-err" role="alert">{err}</p>}
      {!rows ? <p className="pt-empty">Loading</p> : (
        <>
          <section className="bp-panel">
            <h2>Waiting for review ({waiting.length})</h2>
            {waiting.length ? waiting.map((r) => (
              <div key={r.slug} className="stu-desk">
                <div className="stu-desk-h">
                  <div><b>{r.name}</b><small>{r.legalName} · {nameOf(r.regCountry)} · {r.regNumber || "no number"}{r.city ? ` · ${r.city}` : ""} · owner {r.owner || "unknown"}</small></div>
                  <span className={`bp-pill ${PILL[r.status]}`}>Submitted</span>
                </div>
                <dl className="stu-dl">
                  <div><dt>Certificate</dt><dd>{r.doc ? <a href={r.doc} target="_blank" rel="noopener">Open file</a> : "Missing"} · {r.docsOk ? "AI matched name and number" : "AI did not confirm, check by hand"}</dd></div>
                  <div><dt>Payout</dt><dd>{r.payoutMethod === "paypal" ? `PayPal ${r.payoutEmail}` : `${r.payoutBank} ${r.payoutNumber} (${r.payoutName})`}</dd></div>
                  <div><dt>Rights</dt><dd>{r.rightsNote || "None"}</dd></div>
                  <div><dt>Website</dt><dd>{r.website || "None"}</dd></div>
                </dl>
                <div className="pt-inline">
                  <label className="vf-field"><span>Note to the studio (needed to send back)</span><div className="vf-box"><input value={notes[r.slug] ?? ""} onChange={(e) => setNotes((n) => ({ ...n, [r.slug]: e.target.value }))} maxLength={300} placeholder="The certificate name does not match the studio name" /></div></label>
                  <button className="vf-btn ghost danger" disabled={busy === r.slug || !(notes[r.slug] ?? "").trim()} onClick={() => review(r.slug, false)}>Send back</button>
                  <button className="vf-btn red" disabled={busy === r.slug} onClick={() => review(r.slug, true)}>Verify studio</button>
                </div>
              </div>
            )) : <p className="pt-empty">Nothing waiting.</p>}
          </section>
          <section className="bp-panel">
            <h2>Ban requests from studios ({bans.length})</h2>
            {bans.length ? bans.map((b) => (
              <div key={b.id} className="stu-desk">
                <div className="stu-desk-h">
                  <div><b>{b.name} · {b.email}</b><small>{b.studio} · {b.film || "film not given"} · viewer code {b.code} · reported {dayName(b.createdAt)}{b.banned ? " · already closed" : ""}</small></div>
                  <span className="bp-pill amber">Requested</span>
                </div>
                <dl className="stu-dl">
                  <div><dt>Copy</dt><dd><a href={b.link} target="_blank" rel="noopener noreferrer nofollow">{b.link}</a></dd></div>
                  <div><dt>What</dt><dd>{b.kind}{b.what ? ` · ${b.what}` : ""} · {b.place}</dd></div>
                </dl>
                <p className="pt-hint">Open the copy and check the code in the picture reads {b.code} before closing the account.</p>
                <div className="pt-inline">
                  <button className="vf-btn ghost" disabled={busy === b.id} onClick={() => decide(b.id, false)}>Decline</button>
                  <button className="vf-btn red" disabled={busy === b.id} onClick={() => decide(b.id, true)}>Close account</button>
                </div>
              </div>
            )) : <p className="pt-empty">No ban requests.</p>}
          </section>
          <section className="bp-panel">
            <h2>Drafts and sent back</h2>
            {rest.length ? rest.map((r) => (
              <div key={r.slug} className="pt-v">
                <div><b>{r.name}</b><small>{nameOf(r.regCountry)} · {r.owner || "no owner yet"} · since {dayName(r.createdAt)}{r.reviewNote ? ` · ${r.reviewNote}` : ""}</small></div>
                <span className={`bp-pill ${PILL[r.status] ?? "grey"}`}>{r.status[0].toUpperCase() + r.status.slice(1)}</span>
              </div>
            )) : <p className="pt-empty">None.</p>}
          </section>
        </>
      )}
    </div>
  );
}
