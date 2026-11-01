"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { Showtime } from "@/lib/catalog";
import type { ActiveStatus } from "@/lib/family-types";
import KidsTile from "./KidsTile";
import PinPrompt from "./PinPrompt";

const voices: Record<string, string> = { en: "en", yo: "yo-NG", ha: "ha-NG", ig: "ig-NG", fr: "fr-FR", sw: "sw-KE", ar: "ar", hi: "hi-IN", es: "es-ES", pt: "pt-BR" };

// The kids cinema ("Ada's cinema" in Figma 89:1020): big tiles, read-aloud titles in the
// child's language, a bedtime reminder, and ask-a-parent instead of paying.
export default function KidsCinema({ active, films, lang, whenText }: { active: ActiveStatus; films: Showtime[]; lang: string; whenText: Record<string, string> }) {
  const router = useRouter();
  const p = active.profile;
  const [leaving, setLeaving] = useState(false);
  const [asked, setAsked] = useState<Record<string, string>>({});
  const kid = p.kind === "kids";
  const left = p.screenMinutes ? Math.max(0, p.screenMinutes - Math.floor(p.watchedToday / 60)) : null;

  const say = (s: Showtime) => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(`${s.film}. ${s.blurb ?? ""}`);
    u.lang = voices[lang] ?? "en";
    u.rate = 0.9;
    window.speechSynthesis.speak(u);
  };

  const askParent = async (s: Showtime) => {
    setAsked((a) => ({ ...a, [s.id]: "Sending…" }));
    const r = await fetch("/api/family/ask", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ what: `Ticket for ${s.film}`, link: `/film/${s.id}` }) });
    const b = (await r.json().catch(() => ({}))) as { error?: string };
    setAsked((a) => ({ ...a, [s.id]: r.ok ? "Asked! A grown-up will check." : (b.error ?? "Try again") }));
  };

  return (
    <div className={`kd${kid ? "" : " preview"}`}>
      <header className="kd-head">
        <div>
          <h1>{p.name}&apos;s cinema</h1>
          {kid && <span className="fm-pill">Kids mode</span>}
        </div>
        {kid ? (
          <button className="vf-btn ghost" onClick={() => setLeaving(true)}>Leave kids mode</button>
        ) : (
          <Link className="vf-btn ghost" href="/family">Family and kids</Link>
        )}
      </header>

      {active.blocked ? (
        <div className="kd-stop" role="status">
          <span aria-hidden>{active.blocked === "bedtime" ? "🌙" : "⏰"}</span>
          <h2>{active.blocked === "bedtime" ? "It's bedtime" : "That's all for today"}</h2>
          <p>{active.blocked === "bedtime" ? `Films stop at ${p.bedtime}. See you tomorrow!` : "Today's screen time is used up. See you tomorrow!"}</p>
        </div>
      ) : (
        kid && (
          <p className="kd-note">
            {left !== null ? `${left} minutes of films left today` : "No daily limit"}
            {p.bedtime ? ` · Bedtime at ${p.bedtime}` : ""}
          </p>
        )
      )}
      {!kid && <p className="kd-note">This is what kids see. Switch to a kids profile on Family and kids to use it.</p>}

      <div className="kd-grid">
        {films.map((s) => (
          <div key={s.id} className="kd-card">
            <Link href={`/film/${s.id}`} aria-label={s.film}><KidsTile s={s} big /></Link>
            <div className="kd-row">
              <button className="kd-say" onClick={() => say(s)} aria-label={`Read ${s.film} aloud`}>
                <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden><path d="M4 9v6h4l5 4V5L8 9H4z" fill="currentColor" /><path d="M16 8.5a5 5 0 010 7M18.5 6a8.5 8.5 0 010 12" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" /></svg>
              </button>
              <small>{whenText[s.id]}</small>
            </div>
            {kid && p.askToBuy && !active.blocked && (
              asked[s.id] ? <p className="kd-asked" role="status">{asked[s.id]}</p> : <button className="vf-btn red wide" onClick={() => askParent(s)}>Ask a grown-up</button>
            )}
          </div>
        ))}
        {films.length === 0 && <p className="kd-note">No films at this age rating yet.</p>}
      </div>

      {leaving && (
        <PinPrompt
          title="Leave kids mode"
          note="A grown-up enters the parent PIN."
          onCancel={() => setLeaving(false)}
          onDone={async (pin) => {
            const r = await fetch("/api/family/switch", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ profile: "owner", pin }) });
            if (!r.ok) return ((await r.json().catch(() => ({}))) as { error?: string }).error ?? "Try again";
            router.push("/family");
            router.refresh();
            return null;
          }}
        />
      )}
    </div>
  );
}
