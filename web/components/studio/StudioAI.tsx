"use client";
import { useEffect, useRef, useState } from "react";
import { scall } from "./scall";

// Figma "Studio / Studio AI" (39:1345). Questions go to Studio AI with the conversation so far;
// it reads the studio's own numbers through the asking member's role.

type Chart = { title: string; bars: { label: string; value: number; note: string }[] };
type Msg = { role: "user" | "assistant"; text: string; chart?: Chart | null };
const SUGGEST = [
  "How did my last premiere do?",
  "Which countries buy the most seats?",
  "Which campaign sold the most seats?",
  "Compare my last 3 premieres",
  "Draft a press release in French for my next film",
];
const KEY = "ec_studio_ai";

export default function StudioAI({ ask }: { ask: string }) {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState(ask);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const end = useRef<HTMLDivElement>(null);
  const loaded = useRef(false);

  // The conversation survives a reload in this tab only.
  useEffect(() => {
    const t = setTimeout(() => { try { const s = sessionStorage.getItem(KEY); if (s) setMsgs(JSON.parse(s) as Msg[]); } catch {} loaded.current = true; }, 0);
    return () => clearTimeout(t);
  }, []);
  useEffect(() => {
    if (!loaded.current) return;
    try { sessionStorage.setItem(KEY, JSON.stringify(msgs.slice(-30))); } catch {}
    end.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [msgs]);

  async function send(q: string) {
    q = q.trim();
    if (!q || busy) return;
    const next: Msg[] = [...msgs, { role: "user", text: q }];
    setMsgs(next); setText(""); setBusy(true); setErr("");
    if (window.location.search) window.history.replaceState(null, "", "/studio/ai");
    try {
      const a = await scall<{ text: string; chart: Chart | null }>("POST", "ai", { messages: next.map((m) => ({ role: m.role, text: m.text })) });
      setMsgs([...next, { role: "assistant", text: a.text, chart: a.chart }]);
    } catch (e) {
      setErr((e as Error).message); setMsgs(msgs); setText(q);
    } finally { setBusy(false); }
  }

  return (
    <div className="pt-body stai">
      <header className="bp-head">
        <div>
          <h1>Studio AI</h1>
          <p>Knows your films, audience, money and campaigns. Answers in any language.</p>
        </div>
        {msgs.length > 0 && <button type="button" className="vf-btn ghost sm" disabled={busy} onClick={() => { setMsgs([]); setErr(""); }}>New chat</button>}
      </header>
      <section className="stai-panel" aria-label="Conversation">
        <div className="stai-log" aria-live="polite">
          {!msgs.length && <p className="stai-empty">Ask about any film, country, viewer group, campaign or payout. Studio AI only reads your studio&rsquo;s numbers and never changes anything.</p>}
          {msgs.map((m, i) => (
            <div key={i} className={`stai-msg ${m.role}`}>
              {m.text.split(/\n{2,}/).map((p, j) => <p key={j}>{p}</p>)}
              {m.chart && <Bars chart={m.chart} />}
            </div>
          ))}
          {busy && <div className="stai-msg assistant wait" role="status">Studio AI is reading your numbers…</div>}
          <div ref={end} />
        </div>
        {err && <p className="vf-err" role="alert">{err}</p>}
        <form className="stai-ask" onSubmit={(e) => { e.preventDefault(); send(text); }}>
          <input aria-label="Your question" value={text} maxLength={2000} onChange={(e) => setText(e.target.value)} placeholder="Ask about any film, country, viewer group or payout..." />
          <button type="button" className="stai-mic" disabled title="Voice questions are coming soon" aria-label="Voice questions, coming soon">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></svg>
          </button>
          <button className="stai-send" disabled={busy || !text.trim()} aria-label="Send">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M22 2 11 13M22 2l-7 20-4-9-9-4z" /></svg>
          </button>
        </form>
      </section>
      <div className="stai-chips">
        {SUGGEST.map((s) => <button key={s} type="button" disabled={busy} onClick={() => send(s)}>{s}</button>)}
      </div>
    </div>
  );
}

function Bars({ chart }: { chart: Chart }) {
  const max = Math.max(...chart.bars.map((b) => Math.abs(b.value)), 1);
  const top = chart.bars.reduce((a, b) => (Math.abs(b.value) > Math.abs(a.value) ? b : a), chart.bars[0]);
  return (
    <figure className="stai-bars">
      {chart.title && <figcaption>{chart.title}</figcaption>}
      {chart.bars.map((b, i) => (
        <div key={i} className="row">
          <i style={{ width: `${Math.max(4, (Math.abs(b.value) / max) * 70)}%` }} className={b === top ? "top" : ""} />
          <span>{b.label} {b.note}</span>
        </div>
      ))}
    </figure>
  );
}
