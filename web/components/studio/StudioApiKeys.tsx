"use client";
import { useState } from "react";
import { scall } from "./scall";

// "API keys" from the Webhooks and API panel (Figma 39:1073): read-only keys for the studio API.
export type ApiKey = { id: string; name: string; prefix: string; createdAt: string; lastUsedAt: string | null; key?: string };

const day = (iso: string) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" }).format(new Date(iso));

export default function StudioApiKeys({ keys: k0 }: { keys: ApiKey[] | null }) {
  const [keys, setKeys] = useState(k0);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [fresh, setFresh] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr(""); setCopied(false);
    try {
      const r = await scall<{ key: ApiKey }>("POST", "keys", { name: name.trim() });
      setKeys([...(keys ?? []), { ...r.key, key: undefined }]);
      setFresh(r.key.key ?? null); setName("");
    } catch (x) { setErr((x as Error).message); } finally { setBusy(false); }
  }
  async function revoke(k: ApiKey) {
    if (!window.confirm(`Revoke "${k.name}"? Anything using it stops working at once.`)) return;
    setErr("");
    try {
      await scall("DELETE", `keys/${k.id}`);
      setKeys((l) => l?.filter((x) => x.id !== k.id) ?? l);
    } catch (x) { setErr((x as Error).message); }
  }

  if (keys === null) return <p className="vf-err" role="alert">API keys could not be loaded. Refresh to try again.</p>;
  return (
    <div className="stwh-keys" id="api-keys">
      <h3>API keys</h3>
      <p className="pt-hint">Read-only access to your films, sales and payouts. Keep keys on your servers, never in an app or web page.</p>
      {keys.length > 0 && (
        <ul className="stwh-list">
          {keys.map((k) => (
            <li key={k.id} className="stwh-key">
              <span><b>{k.name}</b><small><code>{k.prefix}…</code> · made {day(k.createdAt)} · {k.lastUsedAt ? `last used ${day(k.lastUsedAt)}` : "never used"}</small></span>
              <button type="button" className="vf-btn sm ghost" onClick={() => void revoke(k)} aria-label={`Revoke ${k.name}`}>Revoke</button>
            </li>
          ))}
        </ul>
      )}
      {fresh && (
        <div className="stwh-secret" role="status">
          <b>Your new API key</b>
          <small>Copy it now. It is shown only this once.</small>
          <div><code>{fresh}</code><button type="button" className="vf-btn sm sec" onClick={() => { void navigator.clipboard?.writeText(fresh); setCopied(true); }}>{copied ? "Copied" : "Copy"}</button></div>
        </div>
      )}
      <form className="stwh-kform" onSubmit={add}>
        <label className="vf-field"><span>Key name</span><div className="vf-box"><input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} placeholder="Finance ERP" /></div></label>
        <button className="vf-btn sm" disabled={busy || !name.trim() || keys.length >= 5}>{busy ? "Making" : "Make a key"}</button>
      </form>
      {err && <p className="vf-err" role="alert">{err}</p>}
      <details className="stwh-doc">
        <summary>How to call the API</summary>
        <p>Send the key in the <code>Authorization</code> header. Each key gets 60 calls a minute.</p>
        <pre><code>{`curl -H "Authorization: Bearer ecs_…" \\
  https://e-cinema.net/api/v1/studio/films`}</code></pre>
        <p><code>GET /api/v1/studio/films</code> every screening with seats, gross and payout state. <code>GET /api/v1/studio/films/&lt;showtime id&gt;/sales</code> paid seats for the last 14 days and by country. <code>GET /api/v1/studio/payouts</code> your payouts. Money is in cents.</p>
      </details>
    </div>
  );
}
