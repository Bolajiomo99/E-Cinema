"use client";
import { useState } from "react";
import { nameOf } from "@/lib/countries";
import { can, dayName, type Studio } from "@/lib/studio-types";
import { scall } from "./scall";
import StudioWebhooks, { type Hook } from "./StudioWebhooks";
import type { ApiKey } from "./StudioApiKeys";

// Figma "Studio / Settings" (39:1184). The verified name, country and registration are fixed;
// anything that needs a person at E-Cinema to change says so.
function Soon({ title, text }: { title: string; text: string }) {
  return (
    <div className="stu-set">
      <div><b>{title} <em className="soon-tag">Soon</em></b><small>{text}</small></div>
      <span className="stu-toggle off" aria-hidden><i /></span>
    </div>
  );
}

const ALERTS: { kind: string; title: string; text: string }[] = [
  { kind: "milestones", title: "Seat milestones", text: "25%, 50%, sell-out" },
  { kind: "incidents", title: "Live incidents", text: "Streaming problems logged during a premiere" },
  { kind: "leaks", title: "Leaks found", text: "As soon as someone else on your team reports one" },
  { kind: "weekly", title: "Weekly report", text: "Monday 08:00 Lagos: seats, money, countries and leaks" },
];

export default function StudioSettings({ studio: s0, alerts: a0, hooks, keys }: { studio: Studio; alerts: string[] | null; hooks: Hook[] | null; keys: ApiKey[] | null }) {
  const [s, setS] = useState(s0);
  const [alerts, setAlerts] = useState(a0);
  const [alertErr, setAlertErr] = useState("");
  async function toggle(kind: string) {
    if (!alerts) return;
    const on = !alerts.includes(kind);
    setAlertErr("");
    setAlerts(on ? [...alerts, kind] : alerts.filter((k) => k !== kind));
    try {
      const r = await scall<{ alerts: string[] }>("PUT", `alerts/${kind}`, { On: on });
      setAlerts(r.alerts);
    } catch (e) { setAlerts(alerts); setAlertErr((e as Error).message); }
  }
  const [city, setCity] = useState(s0.city);
  const [website, setWebsite] = useState(s0.website);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const edit = can(s.role, "edit");

  async function save() {
    setBusy(true); setErr(""); setMsg("");
    try {
      const r = await scall<{ studio: Studio }>("PUT", "", { name: s.name, legalName: s.legalName, regCountry: s.regCountry, regNumber: s.regNumber, city: city.trim(), website: website.trim() });
      setS(r.studio);
      setMsg("Saved.");
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }
  async function openDoc() {
    try { const r = await scall<{ url: string }>("GET", "docs"); window.open(r.url, "_blank", "noopener"); } catch (e) { setErr((e as Error).message); }
  }

  return (
    <div className="pt-body">
      <header className="bp-head">
        <div>
          <h1>Studio settings</h1>
          <p>{s.legalName} · {nameOf(s.regCountry)}{s.regNumber ? ` · ${s.regNumber}` : ""}{s.verifiedAt ? ` · verified ${dayName(s.verifiedAt)}` : ""}</p>
        </div>
      </header>
      {msg && <p className="bp-flash" role="status">{msg}</p>}

      <div className="pt-row b">
        <section className="bp-panel">
          <h2>Studio profile</h2>
          <form className="pt-form" onSubmit={(e) => { e.preventDefault(); save(); }}>
            <div className="stuo-grid">
              <label className="vf-field"><span>Studio name</span><div className="vf-box"><input value={s.name} disabled /></div></label>
              <label className="vf-field"><span>Country of registration</span><div className="vf-box"><input value={nameOf(s.regCountry)} disabled /></div></label>
              <label className="vf-field"><span>City</span><div className="vf-box"><input value={city} onChange={(e) => setCity(e.target.value)} maxLength={60} disabled={!edit} /></div></label>
              <label className="vf-field"><span>Website</span><div className="vf-box"><input type="url" value={website} onChange={(e) => setWebsite(e.target.value)} maxLength={200} placeholder="https://" disabled={!edit} /></div></label>
            </div>
            {edit && <div className="pt-btns"><button className="vf-btn red sm" disabled={busy || (city === s.city && website === s.website)}>{busy ? "Saving" : "Save"}</button></div>}
            <p className="pt-hint">To change the verified name or registration, email <a href="mailto:admin@e-cinema.net?subject=Studio%20details">admin@e-cinema.net</a> from an owner&apos;s address.</p>
          </form>
          <div className="stu-set">
            <div><b>Studio page <em className="soon-tag">Soon</em></b><small>e-cinema.net/studios/{s.slug}</small></div>
          </div>
        </section>

        <section className="bp-panel">
          <h2>Rights and territories</h2>
          <div className="stu-set">
            <div><b>Rights declaration</b><small>{s.rightsAt ? `Declared ${dayName(s.rightsAt)}: ${s.rightsNote.slice(0, 120)}${s.rightsNote.length > 120 ? "…" : ""}` : "Not declared yet"}</small></div>
          </div>
          <div className="stu-set">
            <div><b>Company certificate</b><small>{s.docsKey ? (s.docsOk ? "On file · checked by AI" : "On file · checked by our studio team") : "Not uploaded"}</small></div>
            {s.docsKey && <button className="vf-btn sm" onClick={openDoc}>View</button>}
          </div>
          <Soon title="Default territories" text="Choose where your films can be sold by default" />
          <Soon title="AI dub approval" text="Every new language needs your approval before release" />
          <Soon title="Voice cloning of cast" text="Only for cast who signed voice consent" />
        </section>
      </div>

      <div className="pt-row a">
        <StudioWebhooks hooks={hooks} keys={keys} canEdit={edit} />
        <section className="bp-panel" id="notifications">
          <h2>Notifications</h2>
          <p className="pt-hint">Emails to you only. Everyone on your team chooses their own.</p>
          {alerts === null && <p className="vf-err" role="alert">Your email choices could not be loaded. Refresh to try again.</p>}
          {alerts && ALERTS.map((a) => {
            const on = alerts.includes(a.kind);
            return (
              <div key={a.kind} className="stu-set">
                <div><b id={`al-${a.kind}`}>{a.title}</b><small>{a.text}</small></div>
                <button type="button" role="switch" aria-checked={on} aria-labelledby={`al-${a.kind}`} className={`stu-toggle${on ? " on" : ""}`} onClick={() => void toggle(a.kind)}><i /></button>
              </div>
            );
          })}
          {alertErr && <p className="vf-err" role="alert">{alertErr}</p>}
        </section>
      </div>
      {err && <p className="vf-err" role="alert">{err}</p>}
    </div>
  );
}
