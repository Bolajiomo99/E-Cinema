"use client";

import { useCallback, useEffect, useRef, useState } from "react";

interface Clip {
  start: number;
  end: number;
  text: string;
  url: string;
}

const languageName = (code: string) => {
  try {
    return new Intl.DisplayNames([code, "en"], { type: "language" }).of(code) ?? code;
  } catch {
    return code;
  }
};

const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

// Plays an AI dub in time with the screening clock, and lets the viewer switch language mid-scene.
export default function DubbedPlayer({ film, title }: { film: string; title: string }) {
  const [languages, setLanguages] = useState<string[] | null>(null);
  const [lang, setLang] = useState<string>("");
  const [clips, setClips] = useState<Clip[]>([]);
  const [playing, setPlaying] = useState(false);
  const [pos, setPos] = useState(0);
  const [error, setError] = useState("");

  const audio = useRef<Map<number, HTMLAudioElement>>(new Map());
  const started = useRef<Set<number>>(new Set());
  const t0 = useRef(0);
  const posRef = useRef(0);
  const frame = useRef<number>(0);

  const length = clips.length ? Math.ceil(clips[clips.length - 1].end + 1) : 0;
  const line = clips.find((c) => pos >= c.start && pos < c.end);

  useEffect(() => {
    fetch(`/api/dubs/${film}`)
      .then(async (r) => (r.ok ? r.json() : Promise.reject((await r.json()).error)))
      .then((d: { languages: string[] }) => {
        setLanguages(d.languages);
        if (d.languages[0]) setLang(d.languages[0]);
      })
      .catch((e) => setError(String(e ?? "Could not load the dubs")));
  }, [film]);

  const stopAll = useCallback(() => {
    audio.current.forEach((a) => a.pause());
  }, []);

  // Load (and preload) the chosen language; keep the current position.
  useEffect(() => {
    if (!lang) return;
    let cancelled = false;
    stopAll();
    fetch(`/api/dubs/${film}?lang=${lang}`)
      .then(async (r) => (r.ok ? r.json() : Promise.reject((await r.json()).error)))
      .then((d: { clips: Clip[] }) => {
        if (cancelled) return;
        audio.current = new Map(d.clips.map((c, i) => {
          const a = new Audio(c.url);
          a.preload = "auto";
          return [i, a];
        }));
        // Lines already past are treated as played, so switching never replays them.
        started.current = new Set(d.clips.flatMap((c, i) => (c.start < posRef.current ? [i] : [])));
        setClips(d.clips);
      })
      .catch((e) => setError(String(e ?? "Could not load that language")));
    return () => {
      cancelled = true;
    };
  }, [film, lang, stopAll]);

  useEffect(() => {
    if (!playing) return;
    t0.current = performance.now() - posRef.current * 1000;
    const tick = () => {
      const now = (performance.now() - t0.current) / 1000;
      posRef.current = now;
      setPos(now);
      clips.forEach((c, i) => {
        if (now >= c.start && now < c.end && !started.current.has(i)) {
          started.current.add(i);
          audio.current.get(i)?.play().catch(() => setError("Tap play again to allow sound"));
        }
      });
      if (length && now >= length) {
        setPlaying(false);
        return;
      }
      frame.current = requestAnimationFrame(tick);
    };
    frame.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame.current);
  }, [playing, clips, length]);

  const toggle = () => {
    setError("");
    if (playing) {
      stopAll();
      setPlaying(false);
      return;
    }
    if (length && posRef.current >= length) {
      posRef.current = 0;
      setPos(0);
      started.current = new Set();
    }
    setPlaying(true);
  };

  return (
    <div className="player">
      <div className="stage" aria-live="polite">
        <span className="stage-title">{title}</span>
        {line && <p className="subtitle">{line.text}</p>}
        {!playing && clips.length > 0 && (
          <button className="play" onClick={toggle} aria-label="Play">▶</button>
        )}
      </div>
      <div className="controls">
        <button onClick={toggle} disabled={!clips.length}>{playing ? "Pause" : "Play"}</button>
        <div className="progress" role="progressbar" aria-label="Film progress" aria-valuemin={0} aria-valuemax={length} aria-valuenow={Math.floor(pos)}>
          <span style={{ width: length ? `${Math.min(100, (pos / length) * 100)}%` : 0 }} />
        </div>
        <span className="time">{clock(pos)} / {clock(length)}</span>
        <label className="audio-pick">
          Audio
          <select value={lang} onChange={(e) => setLang(e.target.value)} disabled={!languages?.length}>
            {(languages ?? []).map((l) => (
              <option key={l} value={l}>{languageName(l)} (AI)</option>
            ))}
          </select>
        </label>
      </div>
      {languages && languages.length === 0 && <p className="pp-note">No dubs for this film yet.</p>}
      {error && <p className="pp-note pp-err">{error}</p>}
    </div>
  );
}
