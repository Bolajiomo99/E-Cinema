"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { TrackChip, trackName, useTracks } from "@/components/room/Tracks";

// Replays from the Library. On its own the viewer can pause and seek; in a rewatch party
// (syncStart set) everyone follows one shared clock, like the premiere.
type Stream = { hd: string; sd: string; title: string; credit: string; license: string; durationSec: number };

const fmt = (s: number) => {
  const t = Math.max(0, Math.floor(s));
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), sec = t % 60;
  return `${h ? `${h}:${String(m).padStart(2, "0")}` : m}:${String(sec).padStart(2, "0")}`;
};

export default function LibraryPlayer({ film, stream, viewerCode, original, dubFilm, dubLanguages, prefAudio, prefSubs, syncStart, back = "/library", offline = false, credit }: {
  film: string; stream: Stream | null; viewerCode: string; original: string; dubFilm: string; dubLanguages: string[];
  prefAudio: string; prefSubs: string; syncStart?: number; back?: string; offline?: boolean; credit?: string;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const [saver, setSaver] = useState(false);
  const [volume, setVolume] = useState(1);
  const [playing, setPlaying] = useState(false);
  const [pos, setPos] = useState(0);
  const [dur, setDur] = useState(stream?.durationSec ?? 0);
  const [mark, setMark] = useState({ x: 12, y: 18 });
  const [clock, setClock] = useState("");
  const [canBoost, setCanBoost] = useState(false);
  const gain = useRef<GainNode | null>(null);
  const synced = syncStart !== undefined;

  useEffect(() => {
    const t = setInterval(() => {
      setMark({ x: 5 + Math.random() * 60, y: 8 + Math.random() * 70 });
    }, 20000);
    const c = setInterval(() => setClock(new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })), 1000);
    return () => { clearInterval(t); clearInterval(c); };
  }, []);

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

  // In a party, keep within two seconds of the shared clock.
  useEffect(() => {
    if (!synced || !playing || !stream) return;
    const t = setInterval(() => {
      const v = video.current;
      if (!v) return;
      const want = (Date.now() - syncStart!) / 1000;
      if (want >= stream.durationSec) return v.pause();
      if (want >= 0 && Math.abs(v.currentTime - want) > 2) v.currentTime = want;
      if (want >= 0 && v.paused) v.play().catch(() => setPlaying(false));
    }, 1000);
    return () => clearInterval(t);
  }, [synced, playing, syncStart, stream]);

  const toggle = () => {
    const v = video.current;
    if (!v) return;
    if (synced) {
      const want = (Date.now() - syncStart!) / 1000;
      if (want > 0) v.currentTime = Math.min(want, v.duration || want);
      v.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
      return;
    }
    if (v.paused) v.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
    else {
      v.pause();
      setPlaying(false);
    }
  };
  const seek = (s: number) => {
    const v = video.current;
    if (v && !synced) v.currentTime = Math.max(0, Math.min(dur, s));
  };

  if (!stream) {
    return (
      <div className="lp-empty">
        <Link href={back} className="room-back" aria-label="Back to the library">‹</Link>
        <h1>{film}</h1>
        <p className="muted">The film is not available to stream right now. Please try again in a little while.</p>
      </div>
    );
  }

  const waiting = synced && Date.now() < syncStart!;
  return (
    <div className="lp" ref={stage}>
      <header className="room-top">
        <Link href={back} className="room-back" aria-label="Back to the library">‹</Link>
        <div><strong>{film}</strong><span>{synced ? "Rewatch party · everyone in sync" : offline ? "Downloaded · plays without a connection" : "From your library"}</span></div>
      </header>
      <div className="room-player on lp-player" onContextMenu={(e) => e.preventDefault()} onClick={synced ? undefined : toggle}>
        <video
          ref={video}
          src={saver ? stream.sd : stream.hd}
          crossOrigin={canBoost ? "anonymous" : undefined}
          preload="metadata"
          playsInline
          disablePictureInPicture
          controlsList="nodownload noplaybackrate noremoteplayback"
          onLoadedMetadata={(e) => setDur(e.currentTarget.duration || stream.durationSec)}
          onTimeUpdate={(e) => setPos(e.currentTarget.currentTime)}
          onPause={() => !synced && setPlaying(false)}
          onPlay={() => setPlaying(true)}
        />
        <div className="room-mark" style={{ left: `${mark.x}%`, top: `${mark.y}%` }} aria-hidden>E-CINEMA · {viewerCode} · {clock}</div>
        {!playing && (
          <button className="room-join" onClick={(e) => { e.stopPropagation(); toggle(); }} disabled={waiting}>
            <span>▶</span> {waiting ? "The party starts soon" : synced ? "Join the party" : pos > 1 ? "Resume" : "Play"}
          </button>
        )}
      </div>
      {tracks.line && playing && <div className="pc-subtitle" aria-live="polite"><span>{tracks.line}</span></div>}
      <footer className="room-controls">
        {synced ? (
          <div className="room-progress"><span style={{ width: `${dur ? (pos / dur) * 100 : 0}%` }} /></div>
        ) : (
          <input className="lp-seek" type="range" min={0} max={dur || 1} step={1} value={pos} onChange={(e) => seek(Number(e.target.value))} aria-label="Seek"
            style={{ ["--p" as string]: `${dur ? (pos / dur) * 100 : 0}%` }} />
        )}
        <div className="room-row">
          {!synced && (
            <>
              <button type="button" className="pc-icon" onClick={toggle} aria-label={playing ? "Pause" : "Play"}>
                {playing ? <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4" height="14" rx="1" /><rect x="14" y="5" width="4" height="14" rx="1" /></svg>
                  : <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M7 5v14l12-7z" /></svg>}
              </button>
              <button type="button" className="pc-icon" onClick={() => seek(pos - 10)} aria-label="Back 10 seconds">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M4 12a8 8 0 1 0 2.4-5.7M4 4v4h4" /></svg>
              </button>
              <button type="button" className="pc-icon" onClick={() => seek(pos + 10)} aria-label="Forward 10 seconds">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M20 12a8 8 0 1 1-2.4-5.7M20 4v4h-4" /></svg>
              </button>
            </>
          )}
          <span className="pc-live">{fmt(pos)} / {fmt(dur)}</span>
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
          <TrackChip icon="audio" label={`Audio: ${tracks.audio ? `${trackName(tracks.audio)} (AI)` : original}`} value={tracks.audio}
            options={[{ value: "", label: `Original · ${original}` }, ...dubLanguages.map((l) => ({ value: l, label: `${trackName(l)} (AI dub)` }))]}
            onPick={tracks.setAudio} empty="AI dubs show here once this film is dubbed." />
          <TrackChip icon="subs" label={tracks.subs ? trackName(tracks.subs) : "Subtitles off"} value={tracks.subs}
            options={[{ value: "", label: "Off" }, ...dubLanguages.map((l) => ({ value: l, label: trackName(l) }))]}
            onPick={tracks.setSubs} empty="Subtitles show here once this film has them." />
          {!offline && <button className={`pc-chip ${saver ? "on" : ""}`} onClick={() => { const t = video.current?.currentTime ?? 0; setSaver((s) => !s); requestAnimationFrame(() => { if (video.current) video.current.currentTime = t; }); setPlaying(false); }} aria-pressed={saver}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><rect x="3" y="15" width="3" height="5" rx="1" /><rect x="8.5" y="11" width="3" height="9" rx="1" opacity={saver ? 0.35 : 1} /><rect x="14" y="7" width="3" height="13" rx="1" opacity={saver ? 0.35 : 1} /><rect x="19.5" y="3" width="3" height="17" rx="1" opacity={saver ? 0.35 : 1} /></svg>
            <span>{saver ? "Data saver · 360p" : "HD · 720p"}</span>
          </button>}
          <button className="pc-icon" onClick={() => (document.fullscreenElement ? document.exitFullscreen() : stage.current?.requestFullscreen())} aria-label="Full screen">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5" /></svg>
          </button>
        </div>
        <p className="room-credit">{credit ?? `Stand-in film: ${stream.title} ${stream.credit} · ${stream.license}`}</p>
      </footer>
    </div>
  );
}
