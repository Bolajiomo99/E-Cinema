"use client";

import { useState } from "react";

// Asks for the parent PIN (4 to 6 digits). The Go API checks it; five wrong tries pause it.
export default function PinPrompt({ title, note, create, onDone, onCancel }: { title: string; note?: string; create?: boolean; onDone: (pin: string) => Promise<string | null>; onCancel: () => void }) {
  const [pin, setPin] = useState("");
  const [again, setAgain] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const ok = /^\d{4,6}$/.test(pin) && (!create || pin === again);
  return (
    <div className="fm-modal" role="dialog" aria-modal="true" aria-labelledby="pin-title">
      <form
        className="fm-sheet"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!ok || busy) return;
          setBusy(true);
          setErr("");
          const problem = await onDone(pin);
          setBusy(false);
          if (problem) {
            setErr(problem);
            setPin("");
            setAgain("");
          }
        }}
      >
        <h2 id="pin-title">{title}</h2>
        {note && <p>{note}</p>}
        <label>
          <span>{create ? "New parent PIN" : "Parent PIN"}</span>
          <input autoFocus inputMode="numeric" autoComplete="off" type="password" maxLength={6} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))} />
        </label>
        {create && (
          <label>
            <span>Type it again</span>
            <input inputMode="numeric" autoComplete="off" type="password" maxLength={6} value={again} onChange={(e) => setAgain(e.target.value.replace(/\D/g, ""))} />
          </label>
        )}
        {err && <p className="fm-err" role="alert">{err}</p>}
        <div className="fm-actions">
          <button type="button" className="vf-btn ghost" onClick={onCancel}>Cancel</button>
          <button className="vf-btn red" disabled={!ok || busy}>{busy ? "Checking…" : create ? "Set PIN" : "Continue"}</button>
        </div>
      </form>
    </div>
  );
}
