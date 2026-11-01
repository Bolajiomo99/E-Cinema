"use client";
import { useState, useSyncExternalStore } from "react";
import { ALL, NONE, readConsent, saveConsent, type Consent } from "./consent";

const GROUPS: [keyof Consent | "essential", string, string, string][] = [
  ["essential", "Essential", "Sign-in, security, your country and language. The site cannot work without these.", "Always on"],
  ["performance", "Performance", "Counts which pages load slowly so we can fix them. No ads, never sold.", ""],
  ["personalisation", "Personalisation", "Remembers what you watch to suggest films you will like.", ""],
  ["advertising", "Advertising", "Lets partners show you film offers on other sites. Off unless you turn it on.", ""],
];

function subscribe(cb: () => void) { window.addEventListener("ec-consent", cb); return () => window.removeEventListener("ec-consent", cb); }
function snapshot() { const c = readConsent(); return c ? JSON.stringify(c) : ""; }

// Cookie preferences (Figma 92:957): Essential always on, the other three off until chosen.
export default function CookieChoices() {
  const stored = useSyncExternalStore(subscribe, snapshot, () => "");
  const [draft, setDraft] = useState<Consent | null>(null);
  const [saved, setSaved] = useState("");
  const now: Consent = draft ?? (stored ? JSON.parse(stored) : NONE);
  const commit = (c: Consent, msg: string) => { saveConsent(c); setDraft(null); setSaved(msg); };
  return (
    <form onSubmit={(e) => { e.preventDefault(); commit(now, "Choices saved"); }}>
      {GROUPS.map(([k, t, d, note]) => (
        <div className="ck-row" key={k}>
          <div><b>{t}</b><span>{d}</span></div>
          {k === "essential" ? <em>{note}</em> : (
            <label className="ck-sw">
              <input type="checkbox" role="switch" aria-label={t} checked={now[k]} onChange={(e) => { setSaved(""); setDraft({ ...now, [k]: e.target.checked }); }} />
              <i />
            </label>
          )}
        </div>
      ))}
      <div className="lg-btns">
        <button className="vf-btn red" type="submit">Save choices</button>
        <button className="vf-btn ghost" type="button" onClick={() => commit(NONE, "Extras turned off")}>Reject all extras</button>
        <button className="vf-btn ghost" type="button" onClick={() => commit(ALL, "All cookies allowed")}>Accept all</button>
        {saved && <span className="ck-saved" role="status">{saved}</span>}
      </div>
    </form>
  );
}
