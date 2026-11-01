"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Avatar from "./Avatar";
import { IconPhone, IconVideo } from "./icons";

// Voice and video calls between two friends. The browsers talk to each other directly
// (WebRTC, encrypted end to end by DTLS-SRTP); our server only passes the short setup
// messages over the Messages websocket and never sees the audio or video.

export type Signal = { kind: string; video?: boolean; sdp?: RTCSessionDescriptionInit; candidate?: RTCIceCandidateInit };
type Peer = { conv: string; id: string; name: string };
type Phase = "idle" | "outgoing" | "incoming" | "connecting" | "live" | "ended";

const RING_MS = 45_000;
const ENDED: Record<string, string> = {
  decline: "Call declined",
  busy: "On another call",
  end: "Call ended",
  unavailable: "Not online right now. Try again when they open E-Cinema.",
  noanswer: "No answer",
  failed: "The call could not connect",
  media: "Allow the microphone (and camera for video) to call",
};

let iceCache: { at: number; servers: RTCIceServer[] } | null = null;
async function iceServers(): Promise<RTCIceServer[]> {
  if (iceCache && Date.now() - iceCache.at < 10 * 60_000) return iceCache.servers;
  try {
    const r = await fetch("/api/chat/ice", { cache: "no-store" });
    const j = (await r.json()) as { iceServers?: RTCIceServer[] };
    if (r.ok && j.iceServers?.length) iceCache = { at: Date.now(), servers: j.iceServers };
  } catch {}
  return iceCache?.servers ?? [{ urls: ["stun:stun.cloudflare.com:3478", "stun:stun.l.google.com:19302"] }];
}

// A soft two-tone ring made in the browser, so there is no sound file to load.
function ringer() {
  let ctx: AudioContext | null = null;
  let t: ReturnType<typeof setInterval> | null = null;
  const beep = () => {
    if (!ctx) return;
    for (const [f, at] of [[880, 0], [660, 0.25]] as const) {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, ctx.currentTime + at);
      g.gain.exponentialRampToValueAtTime(0.12, ctx.currentTime + at + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + at + 0.22);
      o.connect(g).connect(ctx.destination);
      o.start(ctx.currentTime + at);
      o.stop(ctx.currentTime + at + 0.24);
    }
  };
  return {
    start() { try { ctx = new AudioContext(); beep(); t = setInterval(beep, 2000); } catch {} },
    stop() { if (t) clearInterval(t); t = null; ctx?.close().catch(() => undefined); ctx = null; },
  };
}

export function useCall(send: (data: object) => void) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [peer, setPeer] = useState<Peer | null>(null);
  const [video, setVideo] = useState(false);
  const [muted, setMuted] = useState(false);
  const [camOff, setCamOff] = useState(false);
  const [reason, setReason] = useState("");
  const [since, setSince] = useState(0);
  const [local, setLocal] = useState<MediaStream | null>(null);
  const [remote, setRemote] = useState<MediaStream | null>(null);

  const pc = useRef<RTCPeerConnection | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const pending = useRef<RTCIceCandidateInit[]>([]);
  const peerRef = useRef<Peer | null>(null);
  const phaseRef = useRef<Phase>("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ring = useRef(ringer());
  phaseRef.current = phase;
  peerRef.current = peer;

  const signal = useCallback((conv: string, s: Signal) => send({ type: "call", conversationId: conv, call: s }), [send]);

  const cleanup = useCallback((why: string) => {
    ring.current.stop();
    if (timer.current) clearTimeout(timer.current);
    pc.current?.close();
    pc.current = null;
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    pending.current = [];
    setLocal(null);
    setRemote(null);
    setMuted(false);
    setCamOff(false);
    setReason(ENDED[why] ?? ENDED.end);
    setPhase("ended");
    timer.current = setTimeout(() => { setPhase("idle"); setPeer(null); }, 2500);
  }, []);

  const media = async (withVideo: boolean) => {
    const s = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: withVideo ? { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: "user" } : false });
    stream.current = s;
    setLocal(s);
    return s;
  };

  const connection = async (p: Peer, s: MediaStream) => {
    const c = new RTCPeerConnection({ iceServers: await iceServers() });
    pc.current = c;
    s.getTracks().forEach((t) => c.addTrack(t, s));
    c.onicecandidate = (e) => { if (e.candidate) signal(p.conv, { kind: "ice", candidate: e.candidate.toJSON() }); };
    c.ontrack = (e) => setRemote(e.streams[0] ?? new MediaStream([e.track]));
    c.onconnectionstatechange = () => {
      if (c.connectionState === "connected") { setPhase("live"); setSince(Date.now()); }
      if (c.connectionState === "failed") { signal(p.conv, { kind: "end" }); cleanup("failed"); }
    };
    return c;
  };

  const flush = async () => {
    const c = pc.current;
    if (!c?.remoteDescription) return;
    for (const cand of pending.current.splice(0)) await c.addIceCandidate(cand).catch(() => undefined);
  };

  // Start a call from a chat.
  const start = useCallback(async (p: Peer, withVideo: boolean) => {
    if (phaseRef.current !== "idle" && phaseRef.current !== "ended") return;
    if (timer.current) clearTimeout(timer.current);
    setPeer(p); peerRef.current = p;
    setVideo(withVideo);
    setPhase("outgoing");
    try {
      await media(withVideo);
    } catch {
      return cleanup("media");
    }
    signal(p.conv, { kind: "ring", video: withVideo });
    timer.current = setTimeout(() => { if (phaseRef.current === "outgoing") { signal(p.conv, { kind: "end" }); cleanup("noanswer"); } }, RING_MS);
  }, [signal, cleanup]);

  const accept = useCallback(async () => {
    const p = peerRef.current;
    if (!p || phaseRef.current !== "incoming") return;
    ring.current.stop();
    if (timer.current) clearTimeout(timer.current);
    setPhase("connecting");
    try {
      await connection(p, await media(video));
    } catch {
      signal(p.conv, { kind: "decline" });
      return cleanup("media");
    }
    signal(p.conv, { kind: "accept" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [video, signal, cleanup]);

  const hangUp = useCallback(() => {
    const p = peerRef.current;
    if (!p) return;
    signal(p.conv, { kind: phaseRef.current === "incoming" ? "decline" : "end" });
    cleanup(phaseRef.current === "incoming" ? "decline" : "end");
  }, [signal, cleanup]);

  // Handle a signal from the other person.
  const onSignal = useCallback(async (conv: string, from: string, s: Signal, name: (id: string) => string) => {
    const p = peerRef.current;
    const ph = phaseRef.current;
    if (s.kind === "ring") {
      if (ph !== "idle" && ph !== "ended") return signal(conv, { kind: "busy" });
      if (timer.current) clearTimeout(timer.current);
      const np = { conv, id: from, name: name(from) };
      setPeer(np); peerRef.current = np;
      setVideo(!!s.video);
      setPhase("incoming");
      ring.current.start();
      timer.current = setTimeout(() => { if (phaseRef.current === "incoming") cleanup("noanswer"); }, RING_MS);
      return;
    }
    if (s.kind === "unavailable") {
      if (p?.conv === conv && ph === "outgoing") cleanup("unavailable");
      return;
    }
    if (!p || p.conv !== conv || (from && p.id !== from)) return;
    switch (s.kind) {
      case "accept": {
        if (ph !== "outgoing" || !stream.current) return;
        if (timer.current) clearTimeout(timer.current);
        setPhase("connecting");
        const c = await connection(p, stream.current);
        const offer = await c.createOffer();
        await c.setLocalDescription(offer);
        signal(conv, { kind: "offer", sdp: c.localDescription!.toJSON() });
        break;
      }
      case "offer": {
        const c = pc.current;
        if (!c || !s.sdp) return;
        await c.setRemoteDescription(s.sdp);
        await flush();
        const answer = await c.createAnswer();
        await c.setLocalDescription(answer);
        signal(conv, { kind: "answer", sdp: c.localDescription!.toJSON() });
        break;
      }
      case "answer":
        if (pc.current && s.sdp) { await pc.current.setRemoteDescription(s.sdp); await flush(); }
        break;
      case "ice":
        if (!s.candidate) return;
        if (pc.current?.remoteDescription) await pc.current.addIceCandidate(s.candidate).catch(() => undefined);
        else pending.current.push(s.candidate);
        break;
      case "decline": case "busy": case "end":
        cleanup(s.kind);
        break;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signal, cleanup]);

  // Leaving the page ends the call politely.
  useEffect(() => {
    const bye = () => { const p = peerRef.current; if (p && phaseRef.current !== "idle" && phaseRef.current !== "ended") signal(p.conv, { kind: "end" }); };
    window.addEventListener("pagehide", bye);
    return () => { window.removeEventListener("pagehide", bye); bye(); ring.current.stop(); };
  }, [signal]);

  const toggleMute = () => { stream.current?.getAudioTracks().forEach((t) => (t.enabled = muted)); setMuted(!muted); };
  const toggleCam = () => { stream.current?.getVideoTracks().forEach((t) => (t.enabled = camOff)); setCamOff(!camOff); };

  return { phase, peer, video, muted, camOff, reason, since, local, remote, start, accept, hangUp, onSignal, toggleMute, toggleCam };
}

export type CallState = ReturnType<typeof useCall>;

function Clock({ since }: { since: number }) {
  const [, tick] = useState(0);
  useEffect(() => { const t = setInterval(() => tick((n) => n + 1), 1000); return () => clearInterval(t); }, []);
  const s = Math.max(0, Math.floor((Date.now() - since) / 1000));
  return <>{Math.floor(s / 60)}:{String(s % 60).padStart(2, "0")}</>;
}

function Video({ stream, muted, className }: { stream: MediaStream | null; muted?: boolean; className: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => { if (ref.current) ref.current.srcObject = stream; }, [stream]);
  return <video ref={ref} className={className} autoPlay playsInline muted={muted} />;
}

function Audio({ stream }: { stream: MediaStream | null }) {
  const ref = useRef<HTMLAudioElement>(null);
  useEffect(() => { if (ref.current) ref.current.srcObject = stream; }, [stream]);
  return <audio ref={ref} autoPlay />;
}

const IconMic = ({ off }: { off: boolean }) => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" />{off && <path d="M4 4l16 16" />}</svg>
);
const IconHang = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M12 9c-2.6 0-5.1.6-7.3 1.8-.7.4-1 1.2-.8 2l.6 2c.2.7 1 1.1 1.7.9l2.6-.8c.6-.2 1-.8.9-1.4l-.2-1.4c1.6-.5 3.4-.5 5 0l-.2 1.4c-.1.6.3 1.2.9 1.4l2.6.8c.7.2 1.5-.2 1.7-.9l.6-2c.2-.8-.1-1.6-.8-2C17.1 9.6 14.6 9 12 9z" /></svg>
);

export function CallOverlay({ call }: { call: CallState }) {
  const { phase, peer, video, muted, camOff, reason, since, local, remote } = call;
  if (phase === "idle" || !peer) return null;
  const showVideo = video && (phase === "live" || phase === "connecting");
  const status =
    phase === "outgoing" ? "Ringing…"
      : phase === "incoming" ? `Incoming ${video ? "video" : "voice"} call`
        : phase === "connecting" ? "Connecting…"
          : phase === "ended" ? reason
            : null;
  return (
    <div className={`call ${showVideo ? "video" : ""} ${phase}`} role="dialog" aria-modal="true" aria-label={`Call with ${peer.name}`}>
      {showVideo && <Video stream={remote} className="call-remote" />}
      {!showVideo && <Audio stream={remote} />}
      {video && local && phase !== "ended" && <Video stream={local} muted className={`call-self ${camOff ? "off" : ""}`} />}
      <div className="call-who">
        {!showVideo && <span className={`call-ava ${phase === "incoming" || phase === "outgoing" ? "ring" : ""}`}><Avatar id={peer.id} name={peer.name} size={112} /></span>}
        <strong>{peer.name}</strong>
        <span aria-live="polite">{status ?? <Clock since={since} />}</span>
      </div>
      {phase !== "ended" && (
        <div className="call-bar">
          {phase === "incoming" ? (
            <>
              <button type="button" className="call-btn end" onClick={call.hangUp} aria-label="Decline"><IconHang /></button>
              <button type="button" className="call-btn go" onClick={() => void call.accept()} aria-label="Answer">{video ? <IconVideo /> : <IconPhone />}</button>
            </>
          ) : (
            <>
              <button type="button" className={`call-btn ${muted ? "on" : ""}`} onClick={call.toggleMute} aria-pressed={muted} aria-label={muted ? "Unmute" : "Mute"}><IconMic off={muted} /></button>
              {video && <button type="button" className={`call-btn ${camOff ? "on" : ""}`} onClick={call.toggleCam} aria-pressed={camOff} aria-label={camOff ? "Turn camera on" : "Turn camera off"}><IconVideo /></button>}
              <button type="button" className="call-btn end" onClick={call.hangUp} aria-label="End call"><IconHang /></button>
            </>
          )}
        </div>
      )}
      {phase !== "ended" && <p className="call-note">Calls go straight between your devices and are encrypted end to end.</p>}
    </div>
  );
}
