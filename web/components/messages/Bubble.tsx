"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { Message } from "@/lib/chat-types";
import { IconPause, IconPlay } from "./icons";

const time = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
const mmss = (ms: number) => {
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};
const media = (key: string) => `/api/chat/media?key=${encodeURIComponent(key)}`;

// Bars for the voice-note waveform: steady per message so it does not jump on re-render.
function bars(seed: number): number[] {
  let x = seed || 1;
  return Array.from({ length: 20 }, () => {
    x = (x * 1103515245 + 12345) & 0x7fffffff;
    return 6 + (x % 17);
  });
}

function Voice({ m, translated }: { m: Message; translated?: string }) {
  const audio = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [pos, setPos] = useState(0);
  const dur = m.durationMs ?? 0;
  const b = bars(m.id);
  const done = dur ? Math.min(1, pos / dur) : 0;
  return (
    <div className="msg-b them voice">
      <div className="msg-vn">
        <button type="button" className="msg-vn-play" aria-label={playing ? "Pause voice note" : "Play voice note"}
          onClick={() => { const a = audio.current; if (!a) return; if (a.paused) a.play().catch(() => setPlaying(false)); else a.pause(); }}>
          {playing ? <IconPause /> : <IconPlay />}
        </button>
        <span className="msg-vn-wave" aria-hidden>{b.map((h, i) => <i key={i} style={{ height: h }} className={i / b.length < done ? "on" : ""} />)}</span>
        <span className="msg-vn-t">{mmss(playing || pos ? pos : dur)}</span>
        <audio ref={audio} src={m.mediaKey ? media(m.mediaKey) : undefined} preload="none"
          onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => { setPlaying(false); setPos(0); }}
          onTimeUpdate={(e) => setPos(e.currentTarget.currentTime * 1000)} />
      </div>
      {(translated || m.transcript) && <p className="msg-vn-tr">Transcript · {translated || m.transcript}</p>}
    </div>
  );
}

function PartyCard({ m, mine }: { m: Message; mine: boolean }) {
  const p = m.party;
  if (!p) return <div className={`msg-b ${mine ? "me" : "them"}`}><p>This watch party has ended.</p></div>;
  const start = new Date(p.startsAt);
  const today = start.toDateString() === new Date().toDateString();
  const when = `${today ? "tonight" : start.toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" })} ${time(p.startsAt)}`;
  return (
    <div className="msg-party">
      <span className="msg-poster" aria-hidden><i /></span>
      <span className="msg-party-t"><strong>{p.film} · {when}</strong><span>{m.body || (mine ? "Want to join my party?" : `${m.senderName.split(" ")[0]} invited you to their party`)}</span></span>
      <Link href={`/p/${p.code}`} className="msg-btn">Join</Link>
    </div>
  );
}

export default function Bubble({ m, mine, group, showName, status, translated, onTranslate, onReport }: {
  m: Message; mine: boolean; group: boolean; showName: boolean; status?: string; translated?: string;
  onTranslate?: () => void; onReport?: () => void;
}) {
  const [original, setOriginal] = useState(false);
  useEffect(() => { if (!mine && onTranslate) onTranslate(); }, [mine, onTranslate]);
  const shownText = !mine && translated && !original ? translated : m.body;
  return (
    <div className={`msg-row ${mine ? "me" : "them"}`} data-id={m.id}>
      <div className="msg-col">
        {group && showName && !mine && <span className="msg-name">{m.senderName}</span>}
        {m.kind === "voice" ? <Voice m={m} translated={!mine && !original ? translated : undefined} />
          : m.kind === "party" ? <PartyCard m={m} mine={mine} />
          : (
            <div className={`msg-b ${mine ? "me" : "them"}${m.kind === "photo" ? " photo" : ""}`}>
              {m.kind === "photo" && m.mediaKey && (
                <a href={media(m.mediaKey)} target="_blank" rel="noopener noreferrer"><img src={media(m.mediaKey)} alt={m.body || "Photo"} loading="lazy" /></a>
              )}
              {shownText && <p>{shownText}</p>}
              {mine && <span className="msg-meta">{time(m.createdAt)}{status ? ` · ${status}` : ""}</span>}
            </div>
          )}
        <span className="msg-under">
          {!mine && <time dateTime={m.createdAt}>{time(m.createdAt)}</time>}
          {!mine && translated && translated !== (m.kind === "voice" ? m.transcript : m.body) && (
            <button type="button" onClick={() => setOriginal((o) => !o)}>{original ? "Show translation" : "Translated · show original"}</button>
          )}
          {!mine && onReport && <button type="button" className="msg-report" onClick={onReport}>Report</button>}
          {mine && m.kind !== "text" && m.kind !== "photo" && <time dateTime={m.createdAt}>{time(m.createdAt)}{status ? ` · ${status}` : ""}</time>}
        </span>
      </div>
    </div>
  );
}
