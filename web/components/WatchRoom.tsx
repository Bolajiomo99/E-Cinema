"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type { FilmStream } from "@/lib/media";
import StateCard from "@/components/states/StateCard";

export type RoomMessage = { id: number; name: string; body: string; mine?: boolean; createdAt: string };

type Showtime = { id: string; film: string; studio: string; startsAt: string; durationMin: number };
type Phase = "connecting" | "waiting" | "playing" | "ended";
type Floater = { id: number; emoji: string; left: number };

const REACTIONS = ["🔥", "😂", "😮", "❤️", "👏", "😭"];
const DRIFT_LIMIT = 0.5; // seconds; beyond this the player jumps back into step with everyone

const pad = (n: number) => String(Math.floor(n)).padStart(2, "0");
const clock = (sec: number) => `${Math.floor(sec / 3600)}:${pad((sec % 3600) / 60)}:${pad(sec % 60)}`;

// Keeps this browser's idea of "now" in step with the server, NTP style: the sample with the
// shortest round trip is the most trustworthy, so the offset comes from that one.
function useServerClock(url: string) {
  const [phase, setPhase] = useState<Phase>("connecting");
  const [syncMs, setSyncMs] = useState<number | null>(null);
  const offset = useRef(0);

  useEffect(() => {
    let ws: WebSocket | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let closed = false;
    let retry = 1000;
    const samples: { rtt: number; offset: number }[] = [];

    const connect = () => {
      ws = new WebSocket(url);
      let sent = 0;
      const ping = () => {
        if (ws?.readyState !== WebSocket.OPEN) return;
        ws.send(JSON.stringify({ c: Date.now() }));
        sent++;
        timer = setTimeout(ping, sent < 6 ? 700 : 5000);
      };
      ws.onopen = () => {
        retry = 1000;
        ping();
      };
      ws.onmessage = (e) => {
        const now = Date.now();
        const m = JSON.parse(e.data) as { c: number; s: number; state: Phase };
        const rtt = now - m.c;
        samples.push({ rtt, offset: m.s + rtt / 2 - now });
        if (samples.length > 8) samples.shift();
        const best = samples.reduce((a, b) => (b.rtt < a.rtt ? b : a));
        offset.current = best.offset;
        setSyncMs(Math.round(best.rtt / 2));
        setPhase(m.state);
      };
      ws.onclose = () => {
        clearTimeout(timer);
        if (closed) return;
        setPhase((p) => (p === "ended" ? p : "connecting"));
        timer = setTimeout(connect, retry);
        retry = Math.min(retry * 2, 15000);
      };
    };
    connect();
    return () => {
      closed = true;
      clearTimeout(timer);
      ws?.close();
    };
  }, [url]);

  const now = useCallback(() => Date.now() + offset.current, []);
  return { phase, syncMs, now };
}

// The room's live connection: chat, reactions and the head count. It asks the web server
// for a fresh pass on every (re)connect, since passes only last a few minutes.
function useRoomChannel(wsBase: string, showtimeId: string, initial: RoomMessage[], initialWatching: number) {
  const [messages, setMessages] = useState<RoomMessage[]>(initial);
  const [watching, setWatching] = useState(initialWatching);
  const [floaters, setFloaters] = useState<Floater[]>([]);
  const [online, setOnline] = useState(false);
  const [notice, setNotice] = useState("");
  const [signedOut, setSignedOut] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    let closed = false;
    let retry = 1000;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let nextFloat = 0;

    const connect = async () => {
      const res = await fetch(`/api/rooms/${showtimeId}/pass`, { method: "POST" }).catch(() => null);
      if (closed) return;
      // A 401 means this device's session ended, usually because a newer device signed in.
      if (res?.status === 401) {
        setSignedOut(true);
        return;
      }
      if (!res?.ok) {
        timer = setTimeout(connect, retry);
        retry = Math.min(retry * 2, 30000);
        return;
      }
      const { pass } = (await res.json()) as { pass: string };
      const ws = new WebSocket(`${wsBase}/v1/rooms/${showtimeId}/live?t=${encodeURIComponent(pass)}`);
      wsRef.current = ws;
      ws.onopen = () => {
        retry = 1000;
        setOnline(true);
      };
      ws.onmessage = (e) => {
        const ev = JSON.parse(e.data) as { type: string; message?: RoomMessage; emoji?: string; count?: number; error?: string };
        if (ev.type === "msg" && ev.message) {
          const m = ev.message;
          setMessages((list) => (list.some((x) => x.id === m.id) ? list : [...list.slice(-199), m]));
        } else if (ev.type === "presence" && typeof ev.count === "number") {
          setWatching(ev.count);
        } else if (ev.type === "react" && ev.emoji) {
          const f = { id: nextFloat++, emoji: ev.emoji, left: 10 + Math.random() * 70 };
          setFloaters((list) => [...list.slice(-30), f]);
          setTimeout(() => setFloaters((list) => list.filter((x) => x.id !== f.id)), 2600);
        } else if (ev.type === "error" && ev.error) {
          setNotice(ev.error);
          setTimeout(() => setNotice(""), 3000);
        }
      };
      ws.onclose = () => {
        setOnline(false);
        if (wsRef.current === ws) wsRef.current = null;
        if (!closed) timer = setTimeout(connect, retry);
        retry = Math.min(retry * 2, 30000);
      };
    };
    connect();
    return () => {
      closed = true;
      clearTimeout(timer);
      wsRef.current?.close();
    };
  }, [wsBase, showtimeId]);

  const send = useCallback((payload: object) => {
    const ws = wsRef.current;
    if (ws?.readyState !== WebSocket.OPEN) return false;
    ws.send(JSON.stringify(payload));
    return true;
  }, []);

  return { messages, watching, floaters, online, notice, signedOut, send };
}

export default function WatchRoom({
  showtime,
  viewerCode,
  initialMessages,
  initialWatching,
  stream,
  wsBase,
}: {
  showtime: Showtime;
  viewerCode: string;
  initialMessages: RoomMessage[];
  initialWatching: number;
  stream: FilmStream | null;
  wsBase: string;
}) {
  const { phase, syncMs, now } = useServerClock(`${wsBase}/v1/sync/${showtime.id}`);
  const room = useRoomChannel(wsBase, showtime.id, initialMessages, initialWatching);
  const startMs = Date.parse(showtime.startsAt);
  const totalSec = showtime.durationMin * 60;

  const video = useRef<HTMLVideoElement>(null);
  // Time-based values only exist after mount, so the server and browser render the same HTML.
  const [nowMs, setNowMs] = useState<number | null>(null);
  const [joined, setJoined] = useState(false);
  const [saver, setSaver] = useState(false);
  const [volume, setVolume] = useState(1);
  const [draft, setDraft] = useState("");
  const [mark, setMark] = useState({ x: 12, y: 18 });
  const [audioOnly, setAudioOnly] = useState(false);
  const [wasLive, setWasLive] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);

  const elapsedSec = nowMs === null ? 0 : Math.max(0, Math.min(totalSec, (nowMs - startMs) / 1000));
  const untilStart = nowMs === null ? null : Math.max(0, (startMs - nowMs) / 1000);

  // One heartbeat drives the countdown, the progress bar and drift correction.
  useEffect(() => {
    const beat = () => setNowMs(now());
    const first = setTimeout(beat, 0);
    const t = setInterval(beat, 1000);
    return () => {
      clearTimeout(first);
      clearInterval(t);
    };
  }, [now]);

  useEffect(() => {
    const v = video.current;
    if (!v || !stream || phase !== "playing" || !joined) return;
    const pos = ((now() - startMs) / 1000) % stream.durationSec;
    if (v.readyState >= 1 && Math.abs(v.currentTime - pos) > DRIFT_LIMIT) v.currentTime = pos;
    if (v.paused) v.play().catch(() => setJoined(false));
  }, [nowMs, phase, joined, stream, now, startMs]);

  // The watermark wanders, so it cannot simply be cropped out of a recording.
  useEffect(() => {
    const t = setInterval(() => setMark({ x: 5 + Math.random() * 60, y: 8 + Math.random() * 70 }), 20000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (video.current) video.current.volume = volume;
  }, [volume]);

  useEffect(() => {
    const el = listRef.current;
    if (el && el.scrollHeight - el.scrollTop - el.clientHeight < 140) el.scrollTop = el.scrollHeight;
  }, [room.messages]);

  // Remember that the film was running, so a later reconnect reads as a dropped connection
  // rather than the pre-show lobby.
  useEffect(() => {
    if (phase === "playing" && !wasLive) setWasLive(true);
  }, [phase, wasLive]);
  const dropped = wasLive && phase === "connecting" && !audioOnly;

  const join = () => {
    setJoined(true);
    const v = video.current;
    if (v && stream) {
      v.currentTime = ((now() - startMs) / 1000) % stream.durationSec;
      v.play().catch(() => setJoined(false));
    }
  };

  const sendMessage = (e: React.FormEvent) => {
    e.preventDefault();
    const body = draft.trim();
    if (body && room.send({ type: "msg", body })) setDraft("");
  };

  const wallClock = nowMs === null ? "" : new Date(nowMs).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const live = phase === "playing";

  return (
    <div className="room">
      <div className="room-stage" ref={stage}>
        <header className="room-top">
          <Link href="/" className="room-back" aria-label="Leave the room">‹</Link>
          <div>
            <strong>{showtime.film}</strong>
            <span>
              {showtime.studio} · {live ? `${clock(elapsedSec)} of ${clock(totalSec)}` : phase === "ended" ? "Screening ended" : "World premiere"}
            </span>
          </div>
          <div className="room-badges">
            {live && <span className="badge live"><i />LIVE</span>}
            {audioOnly && <button type="button" className="badge outline" onClick={() => setAudioOnly(false)}>AUDIO ONLY · SHOW VIDEO</button>}
            <span className="badge outline">{room.watching.toLocaleString()} HERE</span>
            <span className={`badge outline ${syncMs === null ? "" : "ok"}`}>{syncMs === null ? "SYNCING" : `SYNCED · ${syncMs} MS`}</span>
          </div>
        </header>

        {(phase === "waiting" || phase === "connecting") && (
          <div className="room-lobby">
            <p className="eyebrow">{showtime.film} starts in</p>
            <div className="room-count">
              {untilStart === null ? "--:--" : untilStart >= 3600 ? `${Math.floor(untilStart / 3600)}:${pad((untilStart % 3600) / 60)}:${pad(untilStart % 60)}` : `${pad(untilStart / 60)}:${pad(untilStart % 60)}`}
            </div>
            <p className="muted">Everyone in the world sees frame one at the same second.</p>
            <div className="room-checks">
              <span className={syncMs !== null ? "ok" : ""}>{syncMs !== null ? `✓ Clock synced · ${syncMs} ms` : "Syncing clock…"}</span>
              <span className={room.online ? "ok" : ""}>{room.online ? "✓ Chat connected" : "Connecting chat…"}</span>
              <span className={stream ? "ok" : ""}>{stream ? "✓ Film ready" : "Film not uploaded yet"}</span>
            </div>
          </div>
        )}

        {phase === "ended" && (
          <StateCard overlay icon="film" title="This premiere has ended" action={{ label: "See what is on next", href: "/releases", primary: true }}>
            Each film screens once. Classic requests and clips from the night are coming soon.
          </StateCard>
        )}

        {dropped && (
          <StateCard overlay icon="offline" title="Your connection dropped" action={{ label: "Switch to audio-only", onClick: () => setAudioOnly(true) }}>
            We kept your seat. Reconnecting and catching you up to the live moment without buffering.
          </StateCard>
        )}

        {room.signedOut && (
          <StateCard overlay icon="shield" title="Too many devices" action={{ label: "Manage devices", href: `/signin?next=/settings/security`, primary: true }}>
            You are signed in on another device. Sign out of one to watch here.
          </StateCard>
        )}

        {stream && (
          <div className={`room-player ${live ? "on" : ""} ${audioOnly ? "audio-only" : ""}`} onContextMenu={(e) => e.preventDefault()}>
            <video
              ref={video}
              src={saver ? stream.sd : stream.hd}
              preload="auto"
              playsInline
              disablePictureInPicture
              controlsList="nodownload noplaybackrate noremoteplayback"
              onLoadedMetadata={() => setNowMs(now())}
            />
            <div className="room-mark" style={{ left: `${mark.x}%`, top: `${mark.y}%` }} aria-hidden>
              E-CINEMA · {viewerCode} · {wallClock}
            </div>
            {live && !joined && (
              <button className="room-join" onClick={join}>
                <span>▶</span> Join the screening
              </button>
            )}
          </div>
        )}
        {!stream && live && <div className="room-lobby"><p className="muted">The film for this screening has not been uploaded yet.</p></div>}

        <div className="room-floaters" aria-hidden>
          {room.floaters.map((f) => (
            <span key={f.id} style={{ left: `${f.left}%` }}>{f.emoji}</span>
          ))}
        </div>

        <footer className="room-controls">
          <div className="room-progress"><span style={{ width: `${(elapsedSec / totalSec) * 100}%` }} /></div>
          <div className="room-row">
            <span className="muted small">{live ? "LIVE · everyone is on the same frame" : "Waiting for the premiere"}</span>
            <label className="room-vol">
              <span aria-hidden>🔊</span>
              <input type="range" min={0} max={1} step={0.05} value={volume} onChange={(e) => setVolume(Number(e.target.value))} aria-label="Volume" />
            </label>
            <span className="room-spacer" />
            <button className={`room-pill ${saver ? "on" : ""}`} onClick={() => { setSaver((s) => !s); setJoined(false); }}>
              Data saver · {saver ? "360p" : "off"}
            </button>
            <button className="room-pill" onClick={() => (document.fullscreenElement ? document.exitFullscreen() : stage.current?.requestFullscreen())} aria-label="Full screen">
              ⛶
            </button>
          </div>
          {stream && <p className="room-credit">Stand-in film: {stream.title} {stream.credit} · {stream.license}</p>}
        </footer>
      </div>

      <aside className="room-side">
        <header>
          <strong>Room · {showtime.film}</strong>
          <span className="muted small">{room.watching.toLocaleString()} here {room.online ? "" : "· reconnecting"}</span>
        </header>
        <div className="room-chat" ref={listRef}>
          {room.messages.length === 0 && <p className="muted small">No messages yet. Say hello to the room.</p>}
          {room.messages.map((m) => (
            <div key={m.id} className={`room-msg ${m.mine ? "mine" : ""}`}>
              <span className="avatar" aria-hidden>{m.name.slice(0, 2).toUpperCase()}</span>
              <div>
                <b>{m.mine ? "You" : m.name}</b>
                <time suppressHydrationWarning>{new Date(m.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time>
                <p>{m.body}</p>
              </div>
            </div>
          ))}
        </div>
        <div className="room-reacts">
          {REACTIONS.map((r) => (
            <button key={r} onClick={() => room.send({ type: "react", emoji: r })} aria-label={`React ${r}`}>{r}</button>
          ))}
        </div>
        {room.notice && <p className="room-notice">{room.notice}</p>}
        <form className="room-input" onSubmit={sendMessage}>
          <input value={draft} onChange={(e) => setDraft(e.target.value)} maxLength={500} placeholder="Message the room" aria-label="Message the room" />
          <button className="cta" disabled={!room.online || !draft.trim()}>Send</button>
        </form>
      </aside>
    </div>
  );
}
