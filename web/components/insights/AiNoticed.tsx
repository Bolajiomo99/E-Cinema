"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

// "E-Cinema AI noticed" (Figma 19:462): Claude reads the viewer's own numbers. Pro and up.
type Note = { title: string; body: string };

export default function AiNoticed({ range, paid }: { range: string; paid: boolean }) {
  const [notes, setNotes] = useState<Note[] | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    if (!paid) return;
    let gone = false;
    fetch(`/api/insights/ai?range=${range}`).then(async (r) => {
      const out = (await r.json().catch(() => ({}))) as { notes?: Note[]; error?: string };
      if (gone) return;
      if (r.ok) setNotes(out.notes ?? []);
      else setErr(out.error ?? "AI insights are paused for a moment");
    }).catch(() => !gone && setErr("AI insights are paused for a moment"));
    return () => { gone = true; };
  }, [range, paid]);
  return (
    <section className="in-card in-ai">
      <div className="in-card-head"><h2>E-Cinema AI noticed <em>PRO</em></h2></div>
      {!paid ? (
        <div className="in-ai-up">
          <p>Pro members get a short read of their habits from E-Cinema AI, with the next premiere picked for their taste.</p>
          <Link href="/plans" className="lib-play">See Pro</Link>
        </div>
      ) : err ? <p className="in-none">{err}</p> : !notes ? (
        <ul className="in-notes">{[0, 1, 2].map((i) => <li key={i} className="in-skel" aria-hidden><b /><span /></li>)}</ul>
      ) : notes.length ? (
        <ul className="in-notes">
          {notes.map((n) => (
            <li key={n.title}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#f5a524" strokeWidth="2" strokeLinecap="round" aria-hidden><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1" /></svg>
              <div><b>{n.title}</b><span>{n.body}</span></div>
            </li>
          ))}
        </ul>
      ) : <p className="in-none">Watch a premiere or two and E-Cinema AI will have something to tell you.</p>}
    </section>
  );
}
