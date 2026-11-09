"use client";

import { useState } from "react";
import type { AppError } from "@/lib/exec";

const WHERE = { browser: "Viewer's browser", web: "Web server", api: "API" } as const;
const ago = (iso: string, now: number) => {
  const m = Math.max(0, Math.round((now - Date.parse(iso)) / 60_000));
  return m < 60 ? `${m} min ago` : m < 48 * 60 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} days ago`;
};

// Error alerts (Infrastructure): every crash grouped, newest first. "Mark fixed" closes one; it
// reopens and emails again if it happens after that.
export default function ExecErrors({ list, now }: { list: AppError[]; now: number }) {
  const [rows, setRows] = useState(list);
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState("");
  const live = rows.filter((e) => !e.resolvedAt);
  async function fix(fp: string) {
    setBusy(fp);
    const r = await fetch(`/api/executive/errors/${fp}`, { method: "POST" }).catch(() => null);
    setBusy("");
    if (r?.ok) setRows((xs) => xs.map((e) => (e.fingerprint === fp ? { ...e, resolvedAt: new Date().toISOString() } : e)));
  }
  return (
    <div className="exc-card" id="errors">
      <h2>Errors, last 30 days</h2>
      <p className="epf-hint">{live.length === 0 ? "No open errors. You and the CTO get an email when a new one happens." : `${live.length} open. You and the CTO get an email when a new one happens, at most once every six hours for each.`}</p>
      {rows.length > 0 && (
        <div className="exn-table" role="table" aria-label="Errors">
          <div className="exn-th exerr-g" role="row"><span>Error</span><span>Where</span><span>Times</span><span>Last seen</span><span /></div>
          {rows.map((e) => (
            <div key={e.fingerprint} className={`exn-tr exerr-g${e.resolvedAt ? " exerr-done" : ""}`} role="row">
              <span className="exerr-msg">
                <button type="button" className="exerr-open" aria-expanded={open === e.fingerprint} onClick={() => setOpen(open === e.fingerprint ? null : e.fingerprint)}>{e.message}</button>
                {e.path && <small>{e.path}</small>}
                {open === e.fingerprint && e.stack && <pre className="exerr-stack">{e.stack}</pre>}
              </span>
              <span>{WHERE[e.source]}</span>
              <span>{e.count.toLocaleString("en-US")}</span>
              <span>{ago(e.lastSeen, now)}</span>
              <span>{e.resolvedAt ? <small className="exin-muted">Fixed</small> : <button type="button" className="lp-btn sm ghost" disabled={busy === e.fingerprint} onClick={() => fix(e.fingerprint)}>Mark fixed</button>}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
