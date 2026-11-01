"use client";

import { useEffect, useState } from "react";

type Q = { q: string; options: string[] };
type Done = { score: number; prizeCents: number; already?: boolean };

// Pre-show quiz: five questions from the film's facts, one try, all five right wins a seat's worth of credit.
export default function Quiz({ showtimeId }: { showtimeId: string }) {
  const [qs, setQs] = useState<Q[] | null>(null);
  const [prize, setPrize] = useState(0);
  const [done, setDone] = useState<Done | null>(null);
  const [answers, setAnswers] = useState<number[]>([]);
  const [correct, setCorrect] = useState<number[] | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch(`/api/rooms/${showtimeId}/quiz`).then((r) => (r.ok ? r.json() : null)).then((b: { questions: Q[]; prizeCents: number; done: Done | null } | null) => {
      if (!b || b.questions.length < 5) return;
      setQs(b.questions);
      setPrize(b.prizeCents);
      setDone(b.done);
    }).catch(() => undefined);
  }, [showtimeId]);

  if (!qs) return null;
  const prizeText = prize ? `$${(prize / 100).toFixed(2)} of credit, a free seat for your next premiere` : "a free seat for your next premiere";
  const i = Math.min(answers.length, qs.length - 1);

  async function choose(n: number) {
    const next = [...answers, n];
    setAnswers(next);
    if (next.length < qs!.length) return;
    setBusy(true);
    const r = await fetch(`/api/rooms/${showtimeId}/quiz`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ answers: next }) });
    const b = (await r.json().catch(() => ({}))) as Done & { correct?: number[]; error?: string };
    setBusy(false);
    if (!r.ok) return setErr(b.error ?? "Could not check your answers.");
    setDone(b);
    setCorrect(b.correct ?? null);
  }

  if (done) {
    return (
      <section className="lb-quiz" aria-live="polite">
        <div className="lb-quiz-head"><h2>Pre-show quiz</h2><span>{done.score} of 5 right</span></div>
        <p className="lb-quiz-q">{done.prizeCents ? `All five right. $${(done.prizeCents / 100).toFixed(2)} of credit is in your account for your next premiere.` : done.already && !correct ? "You have already played tonight's quiz." : "Good try. Five right wins, so have another go at your next premiere."}</p>
        {correct && <ol className="lb-quiz-review">{qs.map((q, k) => <li key={k} className={answers[k] === correct[k] ? "ok" : "no"}>{q.q} <b>{q.options[correct[k]]}</b></li>)}</ol>}
      </section>
    );
  }
  return (
    <section className="lb-quiz">
      <div className="lb-quiz-head"><h2>Pre-show quiz · win {prize ? "a free seat" : "a prize"}</h2><span>Q {i + 1} of 5 · 5 right wins</span></div>
      <p className="lb-quiz-q">{qs[i].q}</p>
      <p className="lb-quiz-note">Your seat tonight is already paid. Get all 5 right to win {prizeText}. One try.</p>
      <div className="lb-quiz-opts" role="group" aria-label="Answers">
        {qs[i].options.map((o, n) => <button key={o} type="button" disabled={busy} onClick={() => choose(n)}>{o}</button>)}
      </div>
      {err && <p className="gf-err" role="alert">{err}</p>}
    </section>
  );
}
