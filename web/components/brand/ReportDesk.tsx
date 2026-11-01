"use client";
import { useState } from "react";
import { naira, PLACES, reportPill, type Report } from "@/lib/brand-types";

// The brand investigators' desk: open fake-seller reports, their photos and AI check, and the
// finding that pays the reporter. Only staff reach it.
const OUTCOMES = ["taken down", "seller fined", "stock seized", "seller now licensed"];

function Row({ r, onDone }: { r: Report; onDone: (r: Report) => void }) {
  const [reward, setReward] = useState(10000);
  const [outcome, setOutcome] = useState(OUTCOMES[0]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const open = r.status === "sent" || r.status === "checking";
  const pill = reportPill(r);

  async function decide(status: string) {
    setBusy(true);
    setErr("");
    try {
      const res = await fetch(`/api/brand/desk/${r.id}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ status, outcome, rewardNgn: reward }) });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? "Could not save");
      onDone({ ...r, ...j, photos: r.photos, reporter: r.reporter });
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <article className="bp-desk-row">
      <header>
        <b>{r.selling}</b>
        <span className={`bp-pill ${pill.tone}`}>{pill.text}</span>
      </header>
      <p className="bp-meta">
        {PLACES.find(([k]) => k === r.place)?.[1]} · {r.link} · {new Date(r.createdAt).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}
        {r.code && <> · label {r.code}</>}
        <br />Reporter: {r.reporter || "anonymous to staff"}{r.country && ` · ${r.country}`}
      </p>
      {r.aiNote && <p className="bp-ai-line">{r.aiNote}</p>}
      {r.photos.length > 0 && (
        <div className="bp-desk-ph">
          {r.photos.map((u, i) => (
            <a key={i} href={u} target="_blank" rel="noreferrer">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={u} alt={`Report photo ${i + 1}`} />
            </a>
          ))}
        </div>
      )}
      {open ? (
        <div className="bp-desk-act">
          {r.status === "sent" && <button className="vf-btn ghost sm" disabled={busy} onClick={() => decide("checking")}>Investigating</button>}
          <label>Outcome <select value={outcome} onChange={(e) => setOutcome(e.target.value)}>{OUTCOMES.map((o) => <option key={o}>{o}</option>)}</select></label>
          <label>Reward ₦ <input type="number" min={5000} max={50000} step={500} value={reward} onChange={(e) => setReward(Number(e.target.value))} /></label>
          <button className="vf-btn red sm" disabled={busy} onClick={() => decide("confirmed")}>Confirm and pay</button>
          <button className="vf-btn ghost sm" disabled={busy} onClick={() => decide("rejected")}>Not enough proof</button>
          <button className="vf-btn ghost sm danger" disabled={busy} onClick={() => decide("false")}>Untrue</button>
        </div>
      ) : (
        <p className="bp-meta">{r.status === "confirmed" ? `Paid ${naira(r.rewardNgn)} and ${r.points} points` : r.status === "false" ? `${r.points} points` : "Closed"}</p>
      )}
      {err && <p className="vf-err" role="alert">{err}</p>}
    </article>
  );
}

export default function ReportDesk({ initial }: { initial: Report[] }) {
  const [list, setList] = useState(initial);
  const open = list.filter((r) => r.status === "sent" || r.status === "checking");
  const done = list.filter((r) => !(r.status === "sent" || r.status === "checking"));
  const update = (r: Report) => setList((l) => l.map((x) => (x.id === r.id ? r : x)));
  return (
    <div className="bp-desk">
      <h1>Brand reports</h1>
      <p className="bp-lead">{open.length} open · confirmed rewards go straight into the reporter&apos;s wallet at today&apos;s rate.</p>
      {open.length === 0 && <p className="bp-none">Nothing waiting. New reports appear here.</p>}
      {open.map((r) => <Row key={r.id} r={r} onDone={update} />)}
      {done.length > 0 && <h2>Decided this week</h2>}
      {done.map((r) => <Row key={r.id} r={r} onDone={update} />)}
    </div>
  );
}
