"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { SupportMessage } from "@/lib/support";

// One support request's conversation, with a reply box (the person's private link, or the desk).
export default function RequestThread({ messages, post, label, staffView = false, closeable = false }: {
  messages: SupportMessage[]; post: string; label: string; staffView?: boolean; closeable?: boolean;
}) {
  const router = useRouter();
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  async function send(close: boolean) {
    setErr(""); setBusy(true);
    const r = await fetch(post, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ body, close }) }).catch(() => null);
    const b = (await r?.json().catch(() => ({}))) as { error?: string };
    setBusy(false);
    if (!r?.ok) { setErr(b.error ?? "That did not send. Please try again."); return; }
    setBody("");
    router.refresh();
  }
  const when = (iso: string) => new Date(iso).toLocaleString([], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  return (
    <div className="rq">
      <ol className="rq-list">
        {messages.map((m, i) => (
          <li key={i} className={m.staff ? "team" : "them"}>
            <span className="rq-who">{m.staff ? "E-Cinema team" : staffView ? "Them" : "You"} · <time dateTime={m.at} suppressHydrationWarning>{when(m.at)}</time></span>
            <p translate={staffView || !m.staff ? "no" : undefined}>{m.body}</p>
          </li>
        ))}
      </ol>
      <form className="rq-form" onSubmit={(e) => { e.preventDefault(); send(false); }}>
        <label htmlFor="rq-body" className="sr-only">{label}</label>
        <textarea id="rq-body" value={body} onChange={(e) => setBody(e.target.value)} rows={4} maxLength={5000} placeholder={label} />
        {err && <p className="hc-err" role="alert">{err}</p>}
        <div className="rq-acts">
          <button className="lp-btn" disabled={busy || !body.trim()}>{busy ? "Sending…" : staffView ? "Send answer" : "Send"}</button>
          {closeable && <button type="button" className="lp-btn secondary" disabled={busy} onClick={() => send(true)}>{body.trim() ? "Send and mark solved" : "Mark solved"}</button>}
        </div>
      </form>
    </div>
  );
}
