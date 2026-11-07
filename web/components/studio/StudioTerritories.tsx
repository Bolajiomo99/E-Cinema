"use client";
import { useMemo, useState } from "react";
import { countryOptions, nameOf } from "@/lib/countries";
import { scall } from "./scall";

// "Default territories" in Studio / Settings (Figma 39:1032): countries where none of the
// studio's films are sold. Checkout refuses seats there and the film page says so.
export function territoriesText(blocked: string[]) {
  if (!blocked.length) return "Worldwide";
  const names = blocked.map(nameOf).sort();
  if (names.length <= 3) return `Worldwide except ${names.slice(0, -1).join(", ")}${names.length > 1 ? " and " : ""}${names[names.length - 1]}`;
  return `Worldwide except ${names.slice(0, 2).join(", ")} and ${names.length - 2} more`;
}

export default function StudioTerritories({ blocked: b0, canEdit, onSaved }: { blocked: string[]; canEdit: boolean; onSaved: (msg: string) => void }) {
  const [blocked, setBlocked] = useState(b0);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<string[]>(b0);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const list = useMemo(() => {
    const all = countryOptions();
    const t = q.trim().toLowerCase();
    return t ? all.filter(([c, n]) => n.toLowerCase().includes(t) || c.toLowerCase() === t) : all;
  }, [q]);

  async function save() {
    setBusy(true); setErr("");
    try {
      const r = await scall<{ blockedCountries: string[] }>("PUT", "territories", { blocked: draft });
      setBlocked(r.blockedCountries); setOpen(false);
      onSaved(r.blockedCountries.length ? `Seats will not be sold in ${r.blockedCountries.length === 1 ? nameOf(r.blockedCountries[0]) : `${r.blockedCountries.length} countries`}.` : "Your films are on sale worldwide.");
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }

  return (
    <>
      <div className="stu-set">
        <div><b>Default territories</b><small>{territoriesText(blocked)}</small></div>
        {canEdit && !open && <button type="button" className="vf-btn sm" onClick={() => { setDraft(blocked); setQ(""); setOpen(true); }}>Edit</button>}
      </div>
      {open && (
        <div className="sttr">
          <p className="pt-hint">Tick the countries where your films must not be sold, for example where you do not hold the rights.</p>
          {draft.length > 0 && (
            <div className="sttr-chips" aria-label="Blocked countries">
              {draft.map((c) => <button key={c} type="button" onClick={() => setDraft(draft.filter((x) => x !== c))} aria-label={`Allow ${nameOf(c)} again`}>{nameOf(c)} ✕</button>)}
            </div>
          )}
          <label className="vf-field"><span>Find a country</span><div className="vf-box"><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="China" /></div></label>
          <ul className="sttr-list">
            {list.map(([c, n]) => (
              <li key={c}><label><input type="checkbox" checked={draft.includes(c)} onChange={(e) => setDraft(e.target.checked ? [...draft, c] : draft.filter((x) => x !== c))} />{n}</label></li>
            ))}
          </ul>
          {err && <p className="vf-err" role="alert">{err}</p>}
          <div className="pt-btns">
            <button type="button" className="vf-btn red sm" disabled={busy} onClick={() => void save()}>{busy ? "Saving" : "Save territories"}</button>
            <button type="button" className="vf-btn sm ghost" onClick={() => setOpen(false)}>Cancel</button>
          </div>
        </div>
      )}
    </>
  );
}
