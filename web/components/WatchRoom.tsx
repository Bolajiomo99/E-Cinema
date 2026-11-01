"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import Lobby from "@/components/room/Lobby";
import SidePanel, { type ChatMessage, type Party, type Poll } from "@/components/room/SidePanel";
import { TrackChip, trackName, useTracks } from "@/components/room/Tracks";
import type { FilmStream } from "@/lib/media";
import StateCard from "@/components/states/StateCard";
import ReviewCard from "@/components/review/ReviewCard";
import CatchUp from "@/components/room/CatchUp";
import ShopDrawer from "@/components/room/ShopDrawer";
import { useWatchBeat } from "@/components/insights/useWatchBeat";

export type RoomMessage = ChatMessage;

type Showtime = { id: string; film: string; studio: string; startsAt: string; durationMin: number };
type Phase = "connecting" | "waiting" | "playing" | "ended";
type Floater = { id: number; emoji: string; left: number };

const CATCH_UP_AFTER = 5 * 60; // seconds into the film before a late arrival gets "what you missed"
const DRIFT_LIMIT = 0.5; // seconds; beyond this the player jumps back into step with everyone

const pad = (n: number) => String(Math.floor(n)).padStart(2, "0");
const clock = (sec: number) => `${Math.floor(sec / 3600)}:${pad((sec % 3600) / 60)}:${pad(sec % 60)}`;

// Keeps this browser's idea of "now" in step with the server, NTP style: the sample with the
// shortest round trip is the most trustworthy, so the offset comes from that one.
export function useServerClock(url: string) {
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
export function useRoomChannel(wsBase: string, showtimeId: string, initial: RoomMessage[], initialWatching: number, initialRoom: RoomMessage[], initialPolls: Poll[]) {
  const [messages, setMessages] = useState<RoomMessage[]>(initial);
  const [roomMessages, setRoomMessages] = useState<RoomMessage[]>(initialRoom);
  const [polls, setPolls] = useState<Poll[]>(initialPolls);
  const [onlineNames, setOnlineNames] = useState<string[] | null>(null);
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
        const ev = JSON.parse(e.data) as { type: string; message?: RoomMessage; emoji?: string; count?: number; error?: string; poll?: Poll; online?: string[]; ids?: number[] };
        if (ev.type === "msg" && ev.message) {
          const m = ev.message;
          const add = (list: RoomMessage[]) => (list.some((x) => x.id === m.id) ? list : [...list.slice(-199), m]);
          if (m.scope === "room") setRoomMessages(add);
          else setMessages(add);
        } else if (ev.type === "poll" && ev.poll) {
          const p = ev.poll;
          // Other people's votes arrive without "mine", so keep the viewer's own answer.
          setPolls((list) => {
            const old = list.find((x) => x.id === p.id);
            const next = { ...p, mine: p.mine ?? old?.mine };
            return old ? list.map((x) => (x.id === p.id ? next : x)) : [next, ...list];
          });
        } else if (ev.type === "friends") {
          setOnlineNames(ev.online ?? []);
        } else if ((ev.type === "hide" || ev.type === "blocked") && ev.ids?.length) {
          const gone = new Set(ev.ids);
          setMessages((list) => list.filter((m) => !gone.has(m.id)));
          setRoomMessages((list) => list.filter((m) => !gone.has(m.id)));
        } else if (ev.type === "reported") {
          setNotice("Thanks. Your report was sent privately.");
          setTimeout(() => setNotice(""), 3500);
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

  return { messages, roomMessages, polls, onlineNames, watching, floaters, online, notice, signedOut, send };
}

export default function WatchRoom({
  showtime,
  viewerCode,
  initialMessages,
  initialWatching,
  stream,
  wsBase,
  audio = "Original",
  subtitles = "English",
  party = null,
  initialRoomMessages = [],
  initialPolls = [],
  initialTalkLeft = -1,
  lang = "en",
  dubFilm = "",
  dubLanguages = [],
  prefAudio = "",
  prefSubs = "",
  myReview = null,
  vrSeat = false,
}: {
  showtime: Showtime;
  viewerCode: string;
  initialMessages: RoomMessage[];
  initialWatching: number;
  stream: FilmStream | null;
  wsBase: string;
  audio?: string;
  subtitles?: string;
  party?: Party | null;
  initialRoomMessages?: RoomMessage[];
  initialPolls?: Poll[];
  initialTalkLeft?: number;
  lang?: string;
  dubFilm?: string;
  dubLanguages?: string[];
  prefAudio?: string;
  prefSubs?: string;
  myReview?: { stars: number; tags: string[]; body: string } | null;
  vrSeat?: boolean;
}) {
  const { phase, syncMs, now } = useServerClock(`${wsBase}/v1/sync/${showtime.id}`);
  const room = useRoomChannel(wsBase, showtime.id, initialMessages, initialWatching, initialRoomMessages, initialPolls);
  const [talkLeft, setTalkLeft] = useState(initialTalkLeft);
  const startMs = Date.parse(showtime.startsAt);
  const totalSec = showtime.durationMin * 60;

  const video = useRef<HTMLVideoElement>(null);
  // Time-based values only exist after mount, so the server and browser render the same HTML.
  const [nowMs, setNowMs] = useState<number | null>(null);
  const [joined, setJoined] = useState(false);
  const [shopping, setShopping] = useState(false);
  const [saver, setSaver] = useState(false);
  const [volume, setVolume] = useState(1);
  const [mark, setMark] = useState({ x: 12, y: 18 });
  const [audioOnly, setAudioOnly] = useState(false);
  const [wasLive, setWasLive] = useState(false);
  const [caughtUp, setCaughtUp] = useState(false);
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

  // Volume goes to 200%: past 100% the sound runs through a Web Audio gain, which needs the film
  // to be served with CORS. The probe finds out first, so a missing header never breaks playback.
  const [canBoost, setCanBoost] = useState(false);
  const gain = useRef<GainNode | null>(null);
  useEffect(() => {
    if (!stream) return;
    fetch(stream.sd, { headers: { Range: "bytes=0-1" }, mode: "cors" }).then((r) => setCanBoost(r.ok)).catch(() => setCanBoost(false));
  }, [stream]);
  const tracks = useTracks(dubFilm, dubLanguages, prefAudio, prefSubs, video, Math.min(volume, 1));
  useEffect(() => {
    const v = video.current;
    if (!v) return;
    const duck = tracks.ducked ? 0.3 : 1;
    if (volume > 1 && canBoost) {
      if (!gain.current) {
        const ctx = new AudioContext();
        const g = ctx.createGain();
        ctx.createMediaElementSource(v).connect(g).connect(ctx.destination);
        gain.current = g;
      }
      v.volume = 1;
    } else v.volume = Math.min(1, volume) * duck;
    if (gain.current) gain.current.gain.value = volume > 1 ? volume * duck : 1;
  }, [volume, canBoost, tracks.ducked]);

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

  // How much of the film the browser already holds, for the lobby's "pre-loaded" check.
  const v0 = video.current;
  const buffered = v0 && v0.buffered.length ? v0.buffered.end(0) : 0;
  const inLobby = (phase === "waiting" || phase === "connecting") && !wasLive && !room.signedOut;

  const wallClock = nowMs === null ? "" : new Date(nowMs).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const live = phase === "playing";
  useWatchBeat(showtime.id, "room", live && joined, tracks.audio, tracks.subs);

  return (
    <div className="room">
      {inLobby && (
        <Lobby
          showtimeId={showtime.id} film={showtime.film} untilStart={untilStart} syncMs={syncMs} online={room.online} watching={room.watching}
          buffered={buffered} hasStream={Boolean(stream)} messages={room.messages} onSend={(body) => room.send({ type: "msg", body })}
          audio={audio} subtitles={subtitles} saver={saver} onSaver={() => setSaver((x) => !x)}
        />
      )}
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
            {vrSeat && <Link href={`/room/${showtime.id}/vr`} className="badge outline">VR CINEMA</Link>}
            <span className="badge outline">{room.watching.toLocaleString()} WATCHING</span>
            <span className={`badge outline ${syncMs === null ? "" : "ok"}`}>{syncMs === null ? "SYNCING" : `SYNCED · ${(syncMs / 1000).toFixed(1)}s`}</span>
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

        {live && !joined && !caughtUp && elapsedSec >= CATCH_UP_AFTER && !dropped && (
          <CatchUp showtimeId={showtime.id} minutesIn={Math.floor(elapsedSec / 60)} partyName={party?.name}
            friends={(party?.members ?? []).filter((m) => !m.me && (room.onlineNames ? room.onlineNames.includes(m.name) : m.online)).map((m) => m.name.split(" ")[0])}
            onJoin={() => { setCaughtUp(true); join(); }} />
        )}

        {phase === "ended" && (
          <div className="room-review">
            <ReviewCard compact showtimeId={showtime.id} eyebrow={`${showtime.film.toUpperCase()} · THE END`} initial={myReview}
              next={{ text: "Each film screens once. See what is on next.", href: "/releases", cta: "Release calendar" }} />
          </div>
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
              crossOrigin={canBoost ? "anonymous" : undefined}
              preload="auto"
              playsInline
              disablePictureInPicture
              controlsList="nodownload noplaybackrate noremoteplayback"
              onLoadedMetadata={() => setNowMs(now())}
            />
            <div className="room-mark" style={{ left: `${mark.x}%`, top: `${mark.y}%` }} aria-hidden>
              E-CINEMA · {viewerCode} · {wallClock}
            </div>
            {live && !joined && elapsedSec < CATCH_UP_AFTER && (
              <button className="room-join" onClick={join}>
                <span>▶</span> Join the screening
              </button>
            )}
          </div>
        )}
        {!stream && live && <div className="room-lobby"><p className="muted">The film for this screening has not been uploaded yet.</p></div>}

        {tracks.line && live && joined && <div className="pc-subtitle" aria-live="polite"><span>{tracks.line}</span></div>}

        <div className="room-floaters" aria-hidden>
          {room.floaters.map((f) => (
            <span key={f.id} style={{ left: `${f.left}%` }}>{f.emoji}</span>
          ))}
        </div>

        <footer className="room-controls">
          <div className="room-progress"><span style={{ width: `${(elapsedSec / totalSec) * 100}%` }} /></div>
          <div className="room-row">
            <span className="pc-live">{live ? "LIVE · cannot skip ahead" : phase === "ended" ? "Screening ended" : "Waiting for the premiere"}</span>
            <label className="pc-vol">
              <button type="button" className="pc-icon" onClick={() => setVolume((x) => (x > 0 ? 0 : 1))} aria-label={volume > 0 ? "Mute" : "Unmute"}>
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round"><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" />{volume > 0 ? <path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11" /> : <path d="m16 9.5 5 5m0-5-5 5" />}</svg>
              </button>
              <span className="pc-track" style={{ ["--v" as string]: `${(volume / (canBoost ? 2 : 1)) * 100}%`, ["--hundred" as string]: canBoost ? "50%" : "100%" }}>
                <input type="range" min={0} max={canBoost ? 2 : 1} step={0.05} value={Math.min(volume, canBoost ? 2 : 1)} onChange={(e) => setVolume(Number(e.target.value))} aria-label="Volume" />
              </span>
              <span className={`pc-pct ${volume > 1 ? "boost" : ""}`}>{Math.round(volume * 100)}%</span>
            </label>
            <span className="room-spacer" />
            <TrackChip icon="audio" label={`Audio: ${tracks.audio ? `${trackName(tracks.audio)} (AI)` : audio.replace(/ \(AI\)$/, "")}`} value={tracks.audio}
              options={[{ value: "", label: `Original${audio.endsWith("(AI)") ? "" : ` · ${audio}`}` }, ...dubLanguages.map((l) => ({ value: l, label: `${trackName(l)} (AI dub)` }))]}
              onPick={tracks.setAudio} empty="AI dubs show here once this film is dubbed." />
            <TrackChip icon="subs" label={tracks.subs ? trackName(tracks.subs) : "Subtitles off"} value={tracks.subs}
              options={[{ value: "", label: "Off" }, ...dubLanguages.map((l) => ({ value: l, label: trackName(l) }))]}
              onPick={tracks.setSubs} empty="Subtitles show here once this film has them." />
            <button className={`pc-chip ${saver ? "on" : ""}`} onClick={() => { setSaver((s) => !s); setJoined(false); }} aria-pressed={saver}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><rect x="3" y="15" width="3" height="5" rx="1" /><rect x="8.5" y="11" width="3" height="9" rx="1" opacity={saver ? 0.35 : 1} /><rect x="14" y="7" width="3" height="13" rx="1" opacity={saver ? 0.35 : 1} /><rect x="19.5" y="3" width="3" height="17" rx="1" opacity={saver ? 0.35 : 1} /></svg>
              <span>{saver ? "Data saver · 360p" : "HD · 720p"}</span>
            </button>
            <button type="button" className="pc-chip" onClick={() => setShopping(true)} aria-haspopup="dialog">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round"><path d="M5 8h14l-1.2 12H6.2z" /><path d="M9 8V6.5a3 3 0 0 1 6 0V8" /></svg>
              <span>Shop the film</span>
            </button>
            <button className="pc-icon" onClick={() => (document.fullscreenElement ? document.exitFullscreen() : stage.current?.requestFullscreen())} aria-label="Full screen">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5" /></svg>
            </button>
          </div>
          {stream && <p className="room-credit">Stand-in film: {stream.title} {stream.credit} · {stream.license}</p>}
        </footer>
      </div>

      {shopping && <ShopDrawer showtimeId={showtime.id} film={showtime.film} friend={party?.members.find((m) => !m.me)?.name.split(" ")[0]} onClose={() => setShopping(false)} />}
      <SidePanel
        showtimeId={showtime.id} film={showtime.film} watching={room.watching} online={room.online} notice={room.notice}
        party={party} onlineNames={room.onlineNames} roomMessages={room.roomMessages} worldMessages={room.messages} polls={room.polls}
        lang={lang} talkLeft={talkLeft} onTalkLeft={setTalkLeft} send={room.send}
      />
    </div>
  );
}
