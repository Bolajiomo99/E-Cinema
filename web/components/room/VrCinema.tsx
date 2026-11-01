"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRoomChannel, useServerClock } from "@/components/WatchRoom";
import type { Party } from "@/components/room/SidePanel";

// VR and AR cinema mode (Figma 52:1122, "Web / VR and AR cinema mode"). On a flat screen it is
// the hall seen from your seat; "Enter VR" puts the same synced film on a curved screen in a
// WebXR headset (Quest, Pico, Vision Pro, Android XR), and the living room mode uses passthrough AR.

type Showtime = { id: string; film: string; studio: string; startsAt: string; durationMin: number };
type Env = "hall" | "rooftop" | "living" | "space";
const ENVS: { id: Env; name: string }[] = [
  { id: "hall", name: "Cinema hall" },
  { id: "rooftop", name: "Rooftop Lagos" },
  { id: "living", name: "Living room (AR)" },
  { id: "space", name: "Space dome" },
];
const REACTIONS = ["🔥", "😂", "😮", "❤️", "👏", "😭"];
const ROWS = ["A", "B", "C", "D", "E", "F"];
const SEATS_PER_ROW = 14;
const DRIFT_LIMIT = 0.5;
const AVATARS = ["#8b7cf6", "#2bb3a3", "#d4a23a", "#e3182d", "#4a90e2"];

// A stable default seat from the viewer's code, so it is the same on every visit until they pick.
function defaultSeat(code: string) {
  let h = 0;
  for (const ch of code) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return { row: 1 + (h % 3), seat: 4 + ((h >>> 3) % 7) };
}

export default function VrCinema({
  showtime, viewerCode, initialWatching, party, wsBase, film,
}: {
  showtime: Showtime; viewerCode: string; initialWatching: number; party: Party | null; wsBase: string;
  film: { durationSec: number; credit: string } | null;
}) {
  const { phase, now } = useServerClock(`${wsBase}/v1/sync/${showtime.id}`);
  const room = useRoomChannel(wsBase, showtime.id, [], initialWatching, [], []);
  const startMs = Date.parse(showtime.startsAt);
  const friendsHere = (party?.members ?? []).filter((m) => !m.me && (room.onlineNames ? room.onlineNames.includes(m.name) : m.online));
  const video = useRef<HTMLVideoElement>(null);
  const [env, setEnv] = useState<Env>("hall");
  const [size, setSize] = useState(71);
  const [seat, setSeat] = useState(() => defaultSeat(viewerCode));
  const [joined, setJoined] = useState(false);
  const [xr, setXr] = useState<{ vr: boolean; ar: boolean }>({ vr: false, ar: false });
  const [inXr, setInXr] = useState(false);
  const [note, setNote] = useState("");
  const [nowMs, setNowMs] = useState<number | null>(null);
  const xrRef = useRef<{ end: () => void; react: (e: string) => void; setEnv: (e: Env) => void; setSize: (s: number) => void } | null>(null);

  // The chosen seat sticks for this premiere.
  useEffect(() => {
    try {
      const s = JSON.parse(localStorage.getItem(`vr-seat-${showtime.id}`) ?? "null");
      if (s && s.row >= 0 && s.row < ROWS.length && s.seat >= 0 && s.seat < SEATS_PER_ROW) setTimeout(() => setSeat(s), 0);
    } catch {}
  }, [showtime.id]);
  const pickSeat = (row: number, s: number) => {
    setSeat({ row, seat: s });
    try { localStorage.setItem(`vr-seat-${showtime.id}`, JSON.stringify({ row, seat: s })); } catch {}
  };

  // What this device's browser can open.
  useEffect(() => {
    const x = (navigator as Navigator & { xr?: { isSessionSupported: (m: string) => Promise<boolean> } }).xr;
    if (!x) return;
    Promise.all([x.isSessionSupported("immersive-vr").catch(() => false), x.isSessionSupported("immersive-ar").catch(() => false)])
      .then(([vr, ar]) => setXr({ vr, ar }));
  }, []);

  useEffect(() => {
    const beat = () => setNowMs(now());
    const first = setTimeout(beat, 0);
    const t = setInterval(beat, 1000);
    return () => { clearTimeout(first); clearInterval(t); };
  }, [now]);

  // Same drift rule as the flat watch room: everyone sees the same frame.
  useEffect(() => {
    const v = video.current;
    if (!v || !film || phase !== "playing" || !joined) return;
    const pos = ((now() - startMs) / 1000) % film.durationSec;
    if (v.readyState >= 1 && Math.abs(v.currentTime - pos) > DRIFT_LIMIT) v.currentTime = pos;
    if (v.paused) v.play().catch(() => setJoined(false));
  }, [nowMs, phase, joined, film, now, startMs]);

  const join = () => {
    setJoined(true);
    const v = video.current;
    if (v && film) {
      v.currentTime = ((now() - startMs) / 1000) % film.durationSec;
      v.play().catch(() => setJoined(false));
    }
  };

  // Reactions from the room float up in the headset too.
  const seen = useRef(0);
  useEffect(() => {
    for (const f of room.floaters) if (f.id >= seen.current) { xrRef.current?.react(f.emoji); seen.current = f.id + 1; }
  }, [room.floaters]);
  useEffect(() => { xrRef.current?.setEnv(env); }, [env]);
  useEffect(() => { xrRef.current?.setSize(size); }, [size]);

  const enter = async (mode: "immersive-vr" | "immersive-ar") => {
    const v = video.current;
    if (!v) return;
    if (!joined) join();
    try {
      const { startXr } = await import("@/components/room/vr-scene");
      xrRef.current = await startXr({ video: v, mode, env: mode === "immersive-ar" ? "living" : env, size, seatRow: seat.row, friends: friendsHere.length, code: viewerCode, onEnd: () => { setInXr(false); xrRef.current = null; } });
      setInXr(true);
    } catch (e) {
      setNote(e instanceof Error ? e.message : "This headset could not open the VR cinema");
      setTimeout(() => setNote(""), 4000);
    }
  };

  const pickEnv = (e: Env) => {
    if (e === "living") {
      if (xr.ar) enter("immersive-ar");
      else { setNote("Living room mode needs a headset with passthrough, such as Quest 3 or Vision Pro."); setTimeout(() => setNote(""), 4000); }
      return;
    }
    setEnv(e);
  };

  const live = phase === "playing";
  const untilStart = nowMs === null ? null : Math.max(0, Math.round((startMs - nowMs) / 1000));
  const waitText = untilStart === null ? "" : untilStart > 3600 ? `Starts in ${Math.floor(untilStart / 3600)}h ${Math.floor((untilStart % 3600) / 60)}m` : `Starts in ${Math.floor(untilStart / 60)}:${String(untilStart % 60).padStart(2, "0")}`;
  const seatLabel = `Row ${ROWS[seat.row]}, seat ${seat.seat + 1}`;
  const hall = `${room.watching.toLocaleString("en")} in this hall`;
  const friendsText = friendsHere.length ? `${friendsHere.length} ${friendsHere.length === 1 ? "friend" : "friends"} in the row · ` : "";
  const scale = 0.55 + (size / 100) * 0.45;

  return (
    <div className={`vr vr-${env}`}>
      <div className="vr-sky" aria-hidden>{env === "rooftop" && <div className="vr-skyline" />}{env === "space" && <div className="vr-stars" />}</div>

      <header className="vr-hud">
        <Link href={`/room/${showtime.id}`} className="vr-back" aria-label="Back to the watch room">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden><path d="M3 8.5A2.5 2.5 0 0 1 5.5 6h13A2.5 2.5 0 0 1 21 8.5v6a2.5 2.5 0 0 1-2.5 2.5H16l-2-2.5h-4L8 17H5.5A2.5 2.5 0 0 1 3 14.5z" /><circle cx="8" cy="11.5" r="1.6" /><circle cx="16" cy="11.5" r="1.6" /></svg>
        </Link>
        <b>{`VR cinema · ${seatLabel}`}</b>
        {live ? <span className="vr-live"><i />LIVE</span> : <span className="vr-wait">{waitText || "Connecting"}</span>}
        <span className="vr-count">{`${friendsText}${hall}`}</span>
      </header>

      <div className="vr-screen" style={{ ["--s" as string]: scale }}>
        <video
          ref={video}
          src={film ? `/api/rooms/${showtime.id}/film?q=hd` : undefined}
          crossOrigin="anonymous"
          preload="auto"
          playsInline
          disablePictureInPicture
          controlsList="nodownload noplaybackrate noremoteplayback"
          onContextMenu={(e) => e.preventDefault()}
          className={live && joined ? "on" : ""}
        />
        {!(live && joined) && <div className="vr-title"><span>{showtime.film.toUpperCase()}</span></div>}
        <span className="vr-mark" aria-hidden>{`E-CINEMA · ${viewerCode}`}</span>
      </div>
      <div className="vr-floor" aria-hidden />

      <div className="vr-seats" role="grid" aria-label="Pick your seat">
        {ROWS.map((r, ri) => (
          <div key={r} className="vr-row" role="row" style={{ opacity: 1 - ri * 0.08, ["--w" as string]: `${79 - ri * 7.6}px` }}>
            {Array.from({ length: SEATS_PER_ROW }, (_, si) => {
              const mine = seat.row === ri && seat.seat === si;
              return <button key={si} role="gridcell" className={`vr-seat${mine ? " mine" : ""}`} aria-label={`Row ${r}, seat ${si + 1}${mine ? ", your seat" : ""}`} aria-selected={mine} onClick={() => pickSeat(ri, si)} />;
            })}
          </div>
        ))}
      </div>

      {friendsHere.length > 0 && (
        <div className="vr-avatars" aria-label="Friends beside you">
          {friendsHere.slice(0, 5).map((f, i) => (
            <span key={f.name} title={f.name} style={{ background: AVATARS[i % AVATARS.length] }}>{f.name.slice(0, 1).toUpperCase()}</span>
          ))}
        </div>
      )}

      <div className="vr-floaters" aria-hidden>{room.floaters.map((f) => <span key={f.id} style={{ left: `${f.left}%` }}>{f.emoji}</span>)}</div>

      <aside className="vr-panel">
        <h2>Your seat</h2>
        <div className="vr-chips">
          {ENVS.map((e) => (
            <button key={e.id} type="button" className={env === e.id ? "on" : ""} aria-pressed={env === e.id} onClick={() => pickEnv(e.id)}>{e.name}</button>
          ))}
        </div>
        <label className="vr-size">
          <span>SCREEN SIZE</span>
          <input type="range" min={0} max={100} value={size} onChange={(e) => setSize(Number(e.target.value))} style={{ ["--p" as string]: `${size}%` }} />
        </label>
        <p>Friends appear as avatars beside you. Reactions float up. <span className="vr-soon">Spatial voice <em className="soon-tag">Soon</em></span></p>
        <div className="vr-react">{REACTIONS.map((r) => <button key={r} type="button" onClick={() => room.send({ type: "react", emoji: r })} aria-label={`React ${r}`}>{r}</button>)}</div>
        {!film ? (
          <p className="vr-fine">The film for this premiere is not uploaded yet.</p>
        ) : !joined ? (
          <button type="button" className="cta vr-go" onClick={join} disabled={!live}>{live ? "Take your seat" : "Opens when the film starts"}</button>
        ) : xr.vr ? (
          <button type="button" className="cta vr-go" onClick={() => (inXr ? xrRef.current?.end() : enter("immersive-vr"))}>{inXr ? "Leave VR" : "Enter VR"}</button>
        ) : (
          <p className="vr-fine">Open this page in your headset&apos;s browser to step inside.</p>
        )}
      </aside>

      <div className="vr-note">
        <b>Works with Meta Quest, Pico, Apple Vision Pro, Android XR and the E‑Cinema headset</b>
        <span>AR mode puts the screen on your wall through the headset camera</span>
      </div>

      {note && <p className="vr-toast" role="status">{note}</p>}
      {room.notice && <p className="vr-toast" role="status">{room.notice}</p>}
      {film && <p className="vr-credit">{film.credit}</p>}
    </div>
  );
}
