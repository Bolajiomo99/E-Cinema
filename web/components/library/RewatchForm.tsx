"use client";

import { useState } from "react";

// Pick when the rewatch starts. Everyone who opens the link plays from the same moment.
const SOON = [
  { label: "In 5 minutes", min: 5 },
  { label: "In 30 minutes", min: 30 },
  { label: "In 1 hour", min: 60 },
  { label: "Tonight at 8 PM", min: -1 },
];

export default function RewatchForm({ showtimeId }: { showtimeId: string }) {
  const [pick, setPick] = useState(0);
  const [custom, setCustom] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const when = () => {
    if (pick === SOON.length) return custom ? new Date(custom) : null;
    const o = SOON[pick];
    if (o.min > 0) return new Date(Date.now() + o.min * 60_000);
    const d = new Date();
    d.setHours(20, 0, 0, 0);
    if (d.getTime() < Date.now() + 60_000) d.setDate(d.getDate() + 1);
    return d;
  };
  const start = async (e: React.FormEvent) => {
    e.preventDefault();
    const at = when();
    if (!at || Number.isNaN(at.getTime())) return setErr("Pick a start time");
    setBusy(true);
    setErr("");
    const r = await fetch("/api/rewatch", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ showtimeId, startsAt: at.toISOString() }) });
    const out = (await r.json().catch(() => ({}))) as { code?: string; error?: string };
    if (!r.ok || !out.code) {
      setBusy(false);
      return setErr(out.error ?? "Could not start the party");
    }
    window.location.assign(`/rewatch/${out.code}`);
  };
  return (
    <form className="rw-form" onSubmit={start}>
      <fieldset>
        <legend>When should it start?</legend>
        {SOON.map((o, i) => (
          <label key={o.label} className={pick === i ? "on" : ""}><input type="radio" name="when" checked={pick === i} onChange={() => setPick(i)} /> {o.label}</label>
        ))}
        <label className={pick === SOON.length ? "on" : ""}>
          <input type="radio" name="when" checked={pick === SOON.length} onChange={() => setPick(SOON.length)} /> Another time
          {pick === SOON.length && <input type="datetime-local" value={custom} onChange={(e) => setCustom(e.target.value)} required aria-label="Start time" />}
        </label>
      </fieldset>
      {err && <p className="lib-err" role="alert">{err}</p>}
      <button type="submit" className="lib-play" disabled={busy}>{busy ? "Starting…" : "Create the party link"}</button>
      <p className="lib-muted">Friends need the film in their own library too: a seat from the premiere within 30 days, or a kept copy.</p>
    </form>
  );
}
