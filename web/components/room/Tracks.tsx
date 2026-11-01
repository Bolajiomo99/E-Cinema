"use client";

import { useEffect, useRef, useState } from "react";

// Player audio and subtitle choices (Figma 17:562 controls: "Audio: Yorùbá (AI)", "English").
// AI dubs are clips timed to the film; while one plays, the original track is turned down so
// music and effects stay. Subtitles come from the same timed lines.

type Clip = { start: number; end: number; text: string; url: string };
const NAMES: Record<string, string> = {
  en: "English", fr: "Français", yo: "Yorùbá", ig: "Igbo", ha: "Hausa", sw: "Kiswahili", ar: "العربية", pt: "Português", es: "Español",
  ko: "한국어", ja: "日本語", zh: "中文", hi: "हिन्दी", de: "Deutsch", it: "Italiano", tr: "Türkçe", am: "አማርኛ", zu: "isiZulu",
};
export const trackName = (l: string) => NAMES[l.split("-")[0]] ?? l.toUpperCase();

async function loadTrack(film: string, lang: string): Promise<Clip[]> {
  const r = await fetch(`/api/dubs/${film}?lang=${lang}`).catch(() => null);
  if (!r?.ok) return [];
  return ((await r.json()) as { clips: Clip[] }).clips ?? [];
}

export function useTracks(film: string, languages: string[], prefAudio: string, prefSubs: string, video: React.RefObject<HTMLVideoElement | null>, volume: number) {
  const [audio, setAudio] = useState(languages.includes(prefAudio) ? prefAudio : "");
  const [subs, setSubs] = useState(languages.includes(prefSubs) ? prefSubs : "");
  const [clips, setClips] = useState<Record<string, Clip[]>>({});
  const [line, setLine] = useState("");
  const playing = useRef<{ clip: Clip; el: HTMLAudioElement } | null>(null);

  useEffect(() => {
    for (const l of [audio, subs]) {
      if (l && !clips[l]) loadTrack(film, l).then((c) => setClips((x) => ({ ...x, [l]: c })));
    }
  }, [audio, subs, film, clips]);

  // Follow the film's clock: show the current line and start the dub clip that covers this moment.
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const v = video.current;
      const t = v?.currentTime ?? 0;
      const live = v && !v.paused;
      const subLine = subs && live ? clips[subs]?.find((c) => t >= c.start && t < c.end)?.text ?? "" : "";
      setLine((old) => (old === subLine ? old : subLine));
      const track = audio && live ? clips[audio] : undefined;
      const clip = track?.find((c) => t >= c.start && t < c.end);
      if (playing.current && playing.current.clip !== clip) {
        playing.current.el.pause();
        playing.current = null;
      }
      if (clip && !playing.current) {
        const el = new Audio(clip.url);
        el.volume = Math.min(1, volume);
        el.currentTime = Math.max(0, t - clip.start);
        el.play().catch(() => {});
        playing.current = { clip, el };
      }
      if (v) v.dataset.ducked = playing.current ? "1" : "";
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      playing.current?.el.pause();
      playing.current = null;
    };
  }, [audio, subs, clips, video, volume]);

  return { audio, setAudio, subs, setSubs, line, ducked: Boolean(audio) };
}

export function TrackChip({ icon, label, value, options, onPick, empty }: {
  icon: "audio" | "subs"; label: string; value: string; options: { value: string; label: string }[]; onPick: (v: string) => void; empty: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);
  return (
    <div className="pc-chip-wrap" ref={ref}>
      <button type="button" className="pc-chip" onClick={() => setOpen((x) => !x)} aria-expanded={open} aria-haspopup="listbox">
        {icon === "audio" ? (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="12" cy="12" r="9.5" /><path d="M2.5 12h19M12 2.5c2.6 2.8 3.8 6 3.8 9.5s-1.2 6.7-3.8 9.5c-2.6-2.8-3.8-6-3.8-9.5S9.4 5.3 12 2.5Z" /></svg>
        ) : (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><rect x="2.5" y="5" width="19" height="14" rx="2.5" /><path d="M6.5 11h3M12 11h5.5M6.5 15h7M15.5 15h2" /></svg>
        )}
        <span>{label}</span>
      </button>
      {open && (
        <ul className="pc-menu" role="listbox">
          {options.map((o) => (
            <li key={o.value} role="option" aria-selected={o.value === value}>
              <button type="button" className={o.value === value ? "on" : ""} onClick={() => { onPick(o.value); setOpen(false); }}>{o.label}</button>
            </li>
          ))}
          {options.length <= 1 && <li className="pc-menu-note">{empty}</li>}
        </ul>
      )}
    </div>
  );
}
