"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import Quiz from "@/components/room/Quiz";

type Msg = { id: string | number; name: string; body: string; mine?: boolean };
const pad = (n: number) => String(Math.floor(n)).padStart(2, "0");

// The room before the film (Figma "Web / Room lobby", 30:989).
export default function Lobby({ showtimeId, film, untilStart, syncMs, online, watching, buffered, hasStream, messages, onSend, audio, subtitles, saver, onSaver }: {
  showtimeId: string; film: string; untilStart: number | null; syncMs: number | null; online: boolean; watching: number;
  buffered: number; hasStream: boolean; messages: Msg[]; onSend: (body: string) => boolean;
  audio: string; subtitles: string; saver: boolean; onSaver: () => void;
}) {
  const [mbps, setMbps] = useState<number | null>(null);
  const [draft, setDraft] = useState("");
  useEffect(() => {
    const c = (navigator as Navigator & { connection?: { downlink?: number } }).connection;
    if (c?.downlink) setMbps(c.downlink);
  }, []);
  const count = untilStart === null ? "--:--" : untilStart >= 86400 ? `${Math.floor(untilStart / 86400)}D ${pad((untilStart % 86400) / 3600)}:${pad((untilStart % 3600) / 60)}` : untilStart >= 3600 ? `${Math.floor(untilStart / 3600)}:${pad((untilStart % 3600) / 60)}:${pad(untilStart % 60)}` : `${pad(untilStart / 60)}:${pad(untilStart % 60)}`;
  const preloaded = Math.min(3, Math.floor(buffered / 60));

  return (
    <div className="lb" role="region" aria-label="Room lobby">
      <header className="lb-top">
        <Link href="/home" className="lb-logo" aria-label="Leave the room">E-CINEMA<svg viewBox="0 0 116 8" aria-hidden><path d="M2 6 Q58 -2 114 6" fill="none" stroke="#e3182d" strokeWidth="2.4" strokeLinecap="round" /></svg></Link>
        <div className="lb-badges"><span>ROOM · {film.toUpperCase()}</span><span>{watching.toLocaleString("en")} HERE</span></div>
      </header>
      <main id="main" className="lb-main">
        <p className="lb-eyebrow">{film.toUpperCase()} STARTS IN</p>
        <div className="lb-count" aria-live="off">{count}</div>
        <p className="lb-sub">Everyone in the world sees frame one at the same second.</p>
        <div className="lb-checks">
          <span className={online ? "ok" : ""}>{online ? `✓ Connection${mbps ? ` ${mbps} Mbps` : " ready"}` : "Connecting…"}</span>
          <span className={preloaded >= 3 ? "ok" : ""}>{!hasStream ? "Film not uploaded yet" : preloaded >= 3 ? "✓ First 3 minutes pre-loaded" : `Pre-loading · ${preloaded} of 3 min`}</span>
          <span className={syncMs !== null ? "ok" : ""}>{syncMs !== null ? `✓ Clock synced · ${syncMs} ms` : "Syncing clock…"}</span>
        </div>
        <Quiz showtimeId={showtimeId} />
        <div className="lb-chips">
          <Link href={`/film/${showtimeId}`} className="on">Audio: {audio}</Link>
          <Link href="/settings/language">Subtitles: {subtitles}</Link>
          <button type="button" onClick={onSaver} aria-pressed={saver}>Data saver: {saver ? "on" : "off"}</button>
        </div>
      </main>
      <aside className="lb-chat" aria-label="Room chat">
        <strong>Room chat</strong>
        <div className="lb-msgs">
          {messages.length === 0 ? <p className="muted">No messages yet. Say hello.</p> : messages.slice(-3).map((m) => <p key={m.id}><b>{m.mine ? "You" : m.name}:</b> <span translate="no">{m.body}</span></p>)}
        </div>
        <form onSubmit={(e) => { e.preventDefault(); if (draft.trim() && onSend(draft.trim())) setDraft(""); }}>
          <input value={draft} onChange={(e) => setDraft(e.target.value)} maxLength={500} placeholder="Message the room" aria-label="Message the room" />
        </form>
      </aside>
    </div>
  );
}
