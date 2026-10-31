"use client";

import Link from "next/link";
import { useState } from "react";

// "Watch it in" (Figma 30:825). The pick is the viewer's audio language, saved to their profile,
// so the watch room starts on that dub. Anything other than the original is an AI dub.
export default function AudioChips({ options, original, initial, auto, signedIn, next }: { options: [string, string][]; original: string; initial: string; auto: boolean; signedIn: boolean; next: string }) {
  const [pick, setPick] = useState(initial);
  const [isAuto, setAuto] = useState(auto);
  const [err, setErr] = useState("");

  async function choose(code: string) {
    const prev = pick;
    setPick(code);
    setAuto(false);
    setErr("");
    if (!signedIn) return;
    const r = await fetch("/api/me/profile", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ audioLanguage: code }) }).catch(() => null);
    if (!r?.ok) { setPick(prev); setErr("Could not save. Try again."); }
  }

  return (
    <>
      <div className="fd-chips" role="radiogroup" aria-label="Audio language">
        {options.map(([code, name]) => {
          const on = code === pick;
          const label = code === original ? `${name} (original)` : `${name} (AI)`;
          return (
            <button key={code} type="button" role="radio" aria-checked={on} className={`br-chip${on ? " on" : ""}`} onClick={() => choose(code)}>
              {label}{on && isAuto ? " · auto-picked" : ""}
            </button>
          );
        })}
      </div>
      <p className="fd-note">
        {signedIn ? "Your pick is saved and the room starts on it. You can switch track during the film." : <>Your pick applies on this visit. <Link href={`/join?next=${encodeURIComponent(next)}`}>Join free</Link> to keep it.</>}
        {err && <span className="fd-err"> {err}</span>}
      </p>
    </>
  );
}
