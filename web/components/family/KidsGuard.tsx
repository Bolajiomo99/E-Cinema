"use client";

import { useEffect, useState } from "react";

// When a kids profile reaches bedtime or its daily limit mid-film, the watch beat says so;
// this pauses every player on the page and covers it until a grown-up takes over.
export default function KidsGuard() {
  const [stop, setStop] = useState<{ blocked: string; message?: string } | null>(null);
  useEffect(() => {
    const on = (e: Event) => {
      const d = (e as CustomEvent<{ blocked: string; message?: string }>).detail;
      document.querySelectorAll("video, audio").forEach((m) => (m as HTMLMediaElement).pause());
      setStop(d);
    };
    window.addEventListener("ec-profile-blocked", on);
    return () => window.removeEventListener("ec-profile-blocked", on);
  }, []);
  useEffect(() => {
    if (!stop) return;
    const t = setInterval(() => document.querySelectorAll("video, audio").forEach((m) => (m as HTMLMediaElement).pause()), 1000);
    return () => clearInterval(t);
  }, [stop]);
  if (!stop) return null;
  return (
    <div className="kd-guard" role="alertdialog" aria-modal="true" aria-labelledby="kg-title">
      <div>
        <span aria-hidden>{stop.blocked === "bedtime" ? "🌙" : "⏰"}</span>
        <h2 id="kg-title">{stop.blocked === "bedtime" ? "It's bedtime" : "That's all for today"}</h2>
        <p>{stop.blocked === "bedtime" ? "The film will be here tomorrow." : "Today's screen time is used up. See you tomorrow!"}</p>
        <a className="vf-btn red" href="/kids">Back to my cinema</a>
      </div>
    </div>
  );
}
