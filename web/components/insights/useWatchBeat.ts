"use client";

import { useEffect, useRef } from "react";

// Sends a heartbeat each minute while a film is actually playing, for the Insights page
// (Figma 19:462). Paused, hidden or offline time is never counted.
export function useWatchBeat(showtimeId: string, mode: "room" | "replay" | "offline", playing: boolean, audio = "", subs = "") {
  const last = useRef(Date.now());
  useEffect(() => {
    if (!playing || !showtimeId) return;
    last.current = Date.now();
    const t = setInterval(() => {
      const secs = Math.round((Date.now() - last.current) / 1000);
      last.current = Date.now();
      if (document.hidden || !navigator.onLine) return;
      fetch("/api/insights/beat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ showtimeId, mode, audio, subs, seconds: Math.min(60, secs) }), keepalive: true })
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
