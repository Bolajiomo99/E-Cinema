"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import LocalWhen from "@/components/dash/LocalWhen";
import { findShowtime, endsAt } from "@/lib/catalog";
import { TYPES, typeOf } from "@/lib/browse";

type Result = { understood: string[]; filters: { types: string[]; from?: number; to?: number; maxPrice?: number; when?: string; audio?: string }; hits: { id: string; why: string }[]; ai: boolean };
type Chip = { key: string; label: string; test: (id: string) => boolean };

const SPEECH_LANG: Record<string, string> = { en: "en-GB", yo: "yo-NG", ha: "ha-NG", ig: "ig-NG", fr: "fr-FR", hi: "hi-IN", ko: "ko-KR", es: "es-ES", pt: "pt-BR", de: "de-DE", ar: "ar-SA", sw: "sw-KE" };
const runtime = (m?: number) => (m ? `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m` : "");

// Search with AI understanding and voice (Figma 30:750). The mic uses the browser's own speech
// recognition, so nothing is recorded or sent anywhere except the words it hears.
export default function SearchBox({ initialQ, initial, lang, prices = {} }: { initialQ: string; initial: Result | null; lang: string; prices?: Record<string, string> }) {
  const router = useRouter();
  const [q, setQ] = useState(initialQ);
  const [res, setRes] = useState<Result | null>(initial);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [chip, setChip] = useState("all");
  const [listening, setListening] = useState(false);
  const [canSpeak, setCanSpeak] = useState(false);
  const rec = useRef<{ stop: () => void } | null>(null);

  useEffect(() => {
    const w = window as unknown as { SpeechRecognition?: unknown; webkitSpeechRecognition?: unknown };
    setCanSpeak(Boolean(w.SpeechRecognition || w.webkitSpeechRecognition));
  }, []);

  async function run(text: string) {
    const t = text.trim();
    if (!t) return;
    setBusy(true); setErr(""); setChip("all");
    router.replace(`/search?q=${encodeURIComponent(t)}`, { scroll: false });
    try {
      const r = await fetch(`/api/search?q=${encodeURIComponent(t)}`);
      const b = await r.json();
      if (!r.ok) throw new Error(b.error ?? "Search failed");
      setRes(b);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Search failed. Try again.");
    } finally {
      setBusy(false);
    }
  }

  function listen() {
    const w = window as unknown as { SpeechRecognition?: new () => SR; webkitSpeechRecognition?: new () => SR };
    const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
    if (!Ctor) return;
    if (listening) { rec.current?.stop(); return; }
    const r = new Ctor();
    r.lang = SPEECH_LANG[lang] ?? "en-GB";
    r.interimResults = true;
    r.onresult = (e) => {
      const text = Array.from(e.results).map((x) => x[0].transcript).join("");
      setQ(text);
      if (e.results[e.results.length - 1].isFinal) run(text);
    };
    r.onend = () => setListening(false);
    r.onerror = () => { setListening(false); setErr("Voice search could not hear you. Check the microphone permission."); };
    rec.current = r;
    setListening(true);
    r.start();
  }

  const chips: Chip[] = useMemo(() => {
    if (!res) return [];
    const f = res.filters;
    const out: Chip[] = [];
    for (const t of f.types) out.push({ key: `t:${t}`, label: TYPES.find((x) => x.id === t)?.label ?? t, test: (id) => typeOf(findShowtime(id)!) === t });
    if (f.audio) out.push({ key: "audio", label: `${f.audio} audio`, test: () => true });
    if (f.when && f.from !== undefined && f.to !== undefined) out.push({ key: "when", label: f.when, test: (id) => { const s = findShowtime(id)!; return endsAt(s) >= f.from! && Date.parse(s.startsAt) < f.to!; } });
    if (f.maxPrice !== undefined) out.push({ key: "price", label: `Under $${f.maxPrice}`, test: (id) => Number(findShowtime(id)!.price.value) <= f.maxPrice! });
    return out;
  }, [res]);
  const hits = (res?.hits ?? []).filter((h) => findShowtime(h.id) && (chip === "all" || chips.find((c) => c.key === chip)?.test(h.id)));

  return (
    <div className="sr">
      <form className="sr-bar" role="search" onSubmit={(e) => { e.preventDefault(); run(q); }}>
        <svg width="22" height="22" viewBox="0 0 22 22" fill="none" stroke="#a6a6b0" strokeWidth="2" strokeLinecap="round" aria-hidden><circle cx="10.08" cy="10.08" r="7.33" /><path d="m19.25 19.25-3.94-3.94" /></svg>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search films, studios or say what you feel like watching" aria-label="Search" maxLength={200} autoFocus={!initialQ} enterKeyHint="search" />
        <button type="button" className={`sr-mic${listening ? " on" : ""}`} onClick={listen} disabled={!canSpeak} aria-pressed={listening} aria-label={listening ? "Stop listening" : "Search by voice"} title={canSpeak ? "Search by voice" : "Voice search needs Chrome, Edge or Safari"}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" aria-hidden><rect x="9" y="2" width="6" height="12" rx="3" /><path d="M5 10a7 7 0 0 0 14 0M12 17v5" /></svg>
        </button>
      </form>
      {busy && <p className="sr-ai">Searching…</p>}
      {err && <p className="sr-ai sr-err" role="alert">{err}</p>}
      {res && !busy && (
        <>
          {res.understood.length > 0 && (
            <p className="sr-ai"><Spark />Understood: {res.understood.join(" · ")}</p>
          )}
          <div className="br-chips" role="group" aria-label="Narrow results">
            <button type="button" className={`br-chip${chip === "all" ? " on" : ""}`} onClick={() => setChip("all")}>All {res.hits.length}</button>
            {chips.map((c) => <button key={c.key} type="button" className={`br-chip${chip === c.key ? " on" : ""}`} onClick={() => setChip(chip === c.key ? "all" : c.key)}>{c.label}</button>)}
          </div>
          {hits.length === 0 ? (
            <div className="br-empty"><strong>No premieres match yet</strong><p>Try fewer words, another week, or <Link href="/browse">browse every format</Link>.</p></div>
          ) : (
            <ul className="sr-list">
              {hits.map((h) => {
                const s = findShowtime(h.id)!;
                const p = s.poster ?? { from: "#1b1b21", via: "#0e0e12", to: "#000", glow: "rgba(227,24,45,.45)" };
                return (
                  <li key={h.id} className="sr-item">
                    <Link href={`/film/${s.id}`} className="sr-poster" style={{ background: `linear-gradient(180deg, ${p.from} 0%, ${p.via} 60%, ${p.to} 100%)` }} aria-hidden tabIndex={-1}>
                      <span className="lp-poster-glow" style={{ background: p.glow }} />
                      <span className="sr-ptitle">{s.film.toUpperCase()}</span>
                    </Link>
                    <div className="sr-t">
                      <Link href={`/film/${s.id}`} className="sr-name">{s.film.toUpperCase()}</Link>
                      <small>{TYPES.find((x) => x.id === typeOf(s))?.label} · {s.year} · {runtime(s.runtimeMin)} · <LocalWhen iso={s.startsAt} /> · {prices[s.id] ?? `$${s.price.value}`}</small>
                      <span className="sr-why"><Spark />{h.why}</span>
                    </div>
                    <Link href={`/checkout?film=${s.id}`} className="lp-btn sm secondary sr-cta">Get a seat</Link>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
      <p className="sr-try">Try: &ldquo;comedy my mum will like in Yorùbá&rdquo; or &ldquo;something like Seoul After Rain&rdquo;{res && !res.ai ? " · Quick search (AI is busy)" : ""}</p>
    </div>
  );
}

function Spark() {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#f5a524" strokeWidth="2" strokeLinecap="round" aria-hidden><path d="M12 2v4M12 18v4M4.9 4.9l2.8 2.8M16.3 16.3l2.8 2.8M2 12h4M18 12h4M4.9 19.1l2.8-2.8M16.3 7.7l2.8-2.8" /></svg>;
}

type SR = {
  lang: string; interimResults: boolean; start: () => void; stop: () => void;
  onresult: (e: { results: ArrayLike<{ 0: { transcript: string }; isFinal: boolean }> }) => void;
  onend: () => void; onerror: () => void;
};
