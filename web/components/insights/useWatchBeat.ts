"use client";

import { useEffect, useRef } from "react";

// What the player adds to each beat (Figma 37:1272 control room, 35:1048 analytics): where it
// is in the film, how far it drifted from the room clock and how long it stalled. The hour and
// weekday are the viewer's own, for "When people watch".
export type PlayerReport = { position: number; driftMs?: number; stallMs?: number; stalls?: number; startMs?: number };

export function deviceKind(): "android" | "ios" | "web" | "tv" | "tablet" | "vr" {
  const ua = navigator.userAgent;
  if (/OculusBrowser|Quest|Pico/i.test(ua)) return "vr";
  if (/SmartTV|SMART-TV|Tizen|Web0S|webOS.TV|CrKey|AFT[A-Z]|BRAVIA|Android TV|GoogleTV/i.test(ua)) return "tv";
  if (/iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return "tablet";
  if (/Android/.test(ua)) return /Mobile/.test(ua) ? "android" : "tablet";
  if (/iPhone|iPod/.test(ua)) return "ios";
  return "web";
}

// Sends a heartbeat each minute while a film is actually playing, for the Insights page
// (Figma 19:462). Paused, hidden or offline time is never counted.
export function useWatchBeat(showtimeId: string, mode: "room" | "replay" | "offline", playing: boolean, audio = "", subs = "", report?: () => PlayerReport | null) {
  const last = useRef(Date.now());
  const read = useRef(report);
  useEffect(() => { read.current = report; });
  useEffect(() => {
    if (!playing || !showtimeId) return;
    last.current = Date.now();
    const t = setInterval(() => {
      const secs = Math.round((Date.now() - last.current) / 1000);
      last.current = Date.now();
      if (document.hidden || !navigator.onLine) return;
      const r = read.current?.();
      const d = new Date();
      const player = r ? { ...r, position: Math.max(0, Math.round(r.position)), device: deviceKind(), hour: d.getHours(), dow: (d.getDay() + 6) % 7 } : {};
      fetch("/api/insights/beat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ showtimeId, mode, audio, subs, seconds: Math.min(60, secs), ...player }), keepalive: true })
        .then((r) => r.json())
        .then((b: { blocked?: string; message?: string }) => {
          // A kids profile reached bedtime or its daily limit: KidsGuard pauses the film.
          if (b?.blocked) window.dispatchEvent(new CustomEvent("ec-profile-blocked", { detail: { blocked: b.blocked, message: b.message } }));
        })
        .catch(() => undefined);
    }, 60_000);
    return () => clearInterval(t);
  }, [showtimeId, mode, playing, audio, subs]);
}
