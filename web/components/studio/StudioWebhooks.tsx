"use client";
import { useState } from "react";
import { scall } from "./scall";

// "Webhooks and API" panel of Studio / Settings (Figma 39:1073): endpoints that hear about
// sales, premieres, payouts and leaks as they happen, each body signed with its own secret.
export type Hook = {
  id: string; url: string; events: string[]; createdAt: string;
  lastStatus: number | null; lastEvent: string; lastAt: string | null; failures: number; pending: number; secret?: string;
};

const EVENTS: [string, string][] = [
  ["ticket.sold", "A seat is paid for"],
  ["premiere.started", "A premiere starts"],
  ["payout.sent", "Your share is paid out"],
  ["leak.detected", "Someone on your team reports a leak"],
];

function ago(iso: string) {
  const s = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
  if (s < 60) return `${s} s ago`;
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  const d = Math.round(s / 86400);
  return `${d} ${d === 1 ? "day" : "days"} ago`;
}

function result(h: Hook) {
  if (!h.lastAt) return { text: h.pending ? "Sending…" : "Nothing sent yet", tone: "" };
  const code = h.lastStatus ?? 0;
  const ok = code >= 200 && code < 300;
  return { text: `${code ? `${code}${ok ? " OK" : ""}` : "No answer"} · ${ago(h.lastAt)}`, tone: ok ? "ok" : "bad" };
}

export default function StudioWebhooks({ hooks: h0, canEdit }: { hooks: Hook[] | null; canEdit: boolean }) {
  const [hooks, setHooks] = useState(h0);
  const [adding, setAdding] = useState(false);
  const [url, setUrl] = useState("");
  const [events, setEvents] = useState<string[]>(EVENTS.map(([e]) => e));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [secret, setSecret] = useState<{ id: string; value: string } | null>(null);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr(""); setMsg("");
    try {
      const r = await scall<{ hook: Hook }>("POST", "webhooks", { url: url.trim(), events });
      setHooks([...(hooks ?? []), { ...r.hook, secret: undefined }]);
      setSecret({ id: r.hook.id, value: r.hook.secret ?? "" });
      setAdding(false); setUrl("");
    } catch (x) { setErr((x as Error).message); } finally { setBusy(false); }
  }
  async function test(id: string) {
    setErr(""); setMsg("");
    try {
      await scall("POST", `webhooks/${id}/test`);
      setMsg("Test event queued. It goes out within a minute.");
      setHooks((l) => l?.map((h) => (h.id === id ? { ...h, pending: h.pending + 1 } : h)) ?? l);
    } catch (x) { setErr((x as Error).message); }
  }
  async function remove(h: Hook) {
    if (!window.confirm(`Stop sending events to ${h.url}?`)) return;
    setErr(""); setMsg("");
    try {
      await scall("DELETE", `webhooks/${h.id}`);
      setHooks((l) => l?.filter((x) => x.id !== h.id) ?? l);
      if (secret?.id === h.id) setSecret(null);
    } catch (x) { setErr((x as Error).message); }
  }

  return (
    <section className="bp-panel stwh" id="webhooks" aria-labelledby="stwh-h">
      <h2 id="stwh-h">Webhooks and API</h2>
      <p className="pt-hint">Get real-time events in your own systems.</p>
      {!canEdit ? <p className="pt-hint">Only owners and admins can manage webhooks.</p> : hooks === null ? <p className="vf-err" role="alert">Webhooks could not be loaded. Refresh to try again.</p> : (
        <>
          {hooks.length === 0 && !adding && <p className="stwh-empty">No endpoints yet. Add one and we will POST signed JSON to it for the events you pick.</p>}
          <ul className="stwh-list">
            {hooks.map((h) => {
              const r = result(h);
              return (
                <li key={h.id} className="stwh-row">
                  <span className="stwh-ev">{h.events.map((e) => <code key={e}>{e}</code>)}</span>
                  <span className="stwh-url" title={h.url}>{h.url}</span>
                  <span className={`stwh-res ${r.tone}`}>{r.text}{h.failures > 1 ? ` · ${h.failures} failed in a row` : ""}</span>
                  <span className="stwh-act">
                    <button type="button" className="vf-btn sm sec" onClick={() => void test(h.id)}>Send test</button>
                    <button type="button" className="vf-btn sm ghost" onClick={() => void remove(h)} aria-label={`Remove ${h.url}`}>Remove</button>
                  </span>
                </li>
              );
            })}
          </ul>
          {secret && (
            <div className="stwh-secret" role="status">
              <b>Signing secret for your new endpoint</b>
              <small>Copy it now. It is shown only this once; to get a new one, remove the endpoint and add it again.</small>
              <div><code>{secret.value}</code><button type="button" className="vf-btn sm sec" onClick={() => { void navigator.clipboard?.writeText(secret.value); setMsg("Secret copied."); }}>Copy</button></div>
            </div>
          )}
          {adding && (
            <form className="stwh-form" onSubmit={add}>
              <label className="vf-field"><span>Endpoint URL</span><div className="vf-box"><input type="url" required value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://api.yourstudio.com/e-cinema" maxLength={500} autoFocus /></div></label>
              <fieldset className="stwh-evs">
                <legend>Events</legend>
                {EVENTS.map(([e, label]) => (
                  <label key={e}><input type="checkbox" checked={events.includes(e)} onChange={(x) => setEvents(x.target.checked ? [...events, e] : events.filter((v) => v !== e))} /><code>{e}</code><small>{label}</small></label>
                ))}
              </fieldset>
              <div className="pt-btns">
                <button className="vf-btn red sm" disabled={busy || !url.trim() || !events.length}>{busy ? "Adding" : "Add endpoint"}</button>
                <button type="button" className="vf-btn sm ghost" onClick={() => { setAdding(false); setErr(""); }}>Cancel</button>
              </div>
            </form>
          )}
          {!adding && <div className="pt-btns"><button type="button" className="vf-btn sm" onClick={() => { setAdding(true); setMsg(""); }} disabled={hooks.length >= 5}>Add endpoint</button></div>}
          {msg && <p className="bp-flash" role="status">{msg}</p>}
          {err && <p className="vf-err" role="alert">{err}</p>}
          <details className="stwh-doc">
            <summary>How to check a request came from us</summary>
            <p>Each request is a POST with a JSON body: <code>{"{ id, type, createdAt, data }"}</code>. The <code>E-Cinema-Signature</code> header reads <code>t=&lt;unix seconds&gt;,v1=&lt;signature&gt;</code>. Compute HMAC-SHA256 of <code>&lt;t&gt;.&lt;raw body&gt;</code> with your signing secret, hex-encode it, and compare it with <code>v1</code>. Ignore requests whose <code>t</code> is more than five minutes old.</p>
            <p>Answer with any 2xx status within 10 seconds. Anything else is retried after 1 minute, 5 minutes, 30 minutes, 2 hours and 8 hours, then dropped. The same event can arrive twice, so use <code>id</code> to skip repeats.</p>
          </details>
        </>
      )}
    </section>
  );
}
