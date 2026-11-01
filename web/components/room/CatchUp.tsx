"use client";

import { useEffect, useRef, useState } from "react";

// Late entry (Figma 118:1480): what the viewer missed, then straight into the live moment.
type Data = { text: string; source: "film" | "synopsis"; minutes: number; lang: string; readSec: number };
const LANG: Record<string, string> = { en: "English", fr: "French", yo: "Yorùbá", ha: "Hausa", ig: "Igbo", sw: "Swahili", ar: "Arabic", pt: "Portuguese", es: "Spanish", hi: "Hindi" };

export default function CatchUp({ showtimeId, minutesIn, friends, partyName, onJoin }: {
  showtimeId: string; minutesIn: number; friends: string[]; partyName?: string; onJoin: () => void;
}) {
  const [data, setData] = useState<Data | null>(null);
  const [listening, setListening] = useState<"idle" | "loading" | "playing">("idle");
  const [err, setErr] = useState("");
  const audio = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    fetch(`/api/rooms/${showtimeId}/catchup`).then((r) => (r.ok ? r.json() : null)).then((d) => d && setData(d)).catch(() => {});
    return () => audio.current?.pause();
  }, [showtimeId]);

  const listen = () => {
    if (listening === "playing") {
      audio.current?.pause();
      return setListening("idle");
    }
    setListening("loading");
    const a = new Audio(`/api/rooms/${showtimeId}/catchup?audio=1`);
    audio.current = a;
    a.onended = () => setListening("idle");
    a.onerror = () => { setListening("idle"); setErr("Listening is not available right now."); };
    a.play().then(() => setListening("playing")).catch(() => { setListening("idle"); setErr("Listening is not available right now."); });
  };

  const join = () => {
    audio.current?.pause();
    onJoin();
  };

  const names = friends.slice(0, 2);
  return (
    <div className="cu-back">
      <div className="cu">
        <p className="cu-eyebrow">WELCOME IN · {minutesIn} MIN IN</p>
        <h2>{data?.source === "synopsis" ? "The story so far" : "Here is what you missed"}</h2>
        <p className="cu-text">{data ? data.text : "Catching you up…"}</p>
        {data && (
          <div className="cu-chips">
            <span className="cu-chip green">{data.source === "film" ? "Spoiler-free" : "From the synopsis"}</span>
            <span className="cu-chip">Read in {LANG[data.lang] ?? data.lang.toUpperCase()} · {data.readSec} s</span>
          </div>
        )}
        <div className="cu-actions">
          <button type="button" className="cu-join" onClick={join}>Join the live moment</button>
          <button type="button" className="cu-listen" onClick={listen} disabled={!data || listening === "loading"}>
            {listening === "playing" ? "Stop listening" : listening === "loading" ? "Loading…" : "Listen instead"}
          </button>
        </div>
        {err && <p className="cu-foot">{err}</p>}
        {names.length > 0 && (
          <p className="cu-foot">
            Your {names.length === 1 ? "friend" : "friends"} {names.join(" and ")}{friends.length > 2 ? ` and ${friends.length - 2} more` : ""} {names.length === 1 ? "is" : "are"} in room{partyName ? ` “${partyName}”` : ""}.
          </p>
        )}
      </div>
    </div>
  );
}
