"use client";
import { useEffect, useRef, useState } from "react";
import { PLACES, type Place } from "@/lib/brand-types";

// Built from the Figma frame "Web / Rewards · Report a fake seller" (114:1733).
type Photo = { key: string; url: string };

export default function ReportForm({ code, photosOn }: { code?: string; photosOn: boolean }) {
  const [place, setPlace] = useState<Place>("online");
  const [link, setLink] = useState("");
  const [selling, setSelling] = useState("");
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [uploading, setUploading] = useState(0);
  const [anon, setAnon] = useState(false);
  const [ai, setAi] = useState<{ note: string; tone: string } | null>(null);
  const [checking, setChecking] = useState(false);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const seq = useRef(0);

  const label = place === "online" || place === "social" ? "Link or address" : place === "market" ? "Market, shop or street" : "Where it was delivered from";
  const hint = place === "online" ? "ecinema-store-ng.shop" : place === "social" ? "instagram.com/the-seller" : place === "market" ? "Balogun market, stall 14, Lagos" : "Seller's name or number, and your city";

  // The AI check runs when the photos or link settle.
  useEffect(() => {
    if (!photos.length && link.trim().length < 4) {
      setAi(null);
      return;
    }
    const n = ++seq.current;
    const t = setTimeout(async () => {
      setChecking(true);
      try {
        const r = await fetch("/api/brand/check", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ link, photos: photos.map((p) => p.key) }) });
        const j = await r.json();
        if (n === seq.current && r.ok) setAi(j.note ? j : null);
      } finally {
        if (n === seq.current) setChecking(false);
      }
    }, 900);
    return () => clearTimeout(t);
  }, [photos, link]);

  async function add(files: FileList | null) {
    if (!files) return;
    setErr("");
    for (const f of Array.from(files).slice(0, 6 - photos.length)) {
      setUploading((u) => u + 1);
      try {
        const fd = new FormData();
        fd.append("file", f);
        const r = await fetch("/api/brand/photo", { method: "POST", body: fd });
        const j = await r.json();
        if (!r.ok) throw new Error(j.error ?? "Upload failed");
        setPhotos((p) => [...p, { key: j.key, url: URL.createObjectURL(f) }]);
      } catch (e) {
        setErr((e as Error).message);
      } finally {
        setUploading((u) => u - 1);
      }
    }
    if (file.current) file.current.value = "";
  }

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (link.trim().length < 3) return setErr(`Add the ${label.toLowerCase()}`);
    if (selling.trim().length < 3) return setErr("Say what they are selling");
    setBusy(true);
    setErr("");
    try {
      const r = await fetch("/api/brand/report", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ place, link, selling, code, photos: photos.map((p) => p.key), anonymous: anon }) });
      const j = await r.json();
      if (r.status === 401) return void (location.href = `/signin?next=${encodeURIComponent(location.pathname + location.search)}`);
      if (!r.ok) throw new Error(j.error ?? "Could not send the report");
      location.href = "/rewards?sent=1";
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <form className="bp-card" onSubmit={send}>
      <h1>Report a fake seller</h1>
      <p className="bp-lead">Your report is private. The seller never learns who reported them.</p>
      {code && <p className="bp-code">About the label <b>{code}</b>, which did not check out as genuine.</p>}
      <fieldset className="bp-q">
        <legend>Where did you see it?</legend>
        <div className="bp-chips" role="radiogroup">
          {PLACES.map(([k, t]) => (
            <button key={k} type="button" role="radio" aria-checked={place === k} className={place === k ? "on" : ""} onClick={() => setPlace(k)}>{t}</button>
          ))}
        </div>
      </fieldset>
      <label className="vf-field">
        <span>{label}</span>
        <div className="vf-box"><input value={link} onChange={(e) => setLink(e.target.value)} placeholder={hint} maxLength={300} /></div>
      </label>
      <label className="vf-field">
        <span>What are they selling?</span>
        <div className="vf-box"><input value={selling} onChange={(e) => setSelling(e.target.value)} placeholder="Tees, caps and a VR headset with the E-Cinema logo" maxLength={300} /></div>
      </label>
      <div className="bp-ph">
        {photos.map((p, i) => (
          <div key={p.key} className="bp-shot">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={p.url} alt={`Photo ${i + 1}`} />
            <button type="button" aria-label={`Remove photo ${i + 1}`} onClick={() => setPhotos((ps) => ps.filter((x) => x.key !== p.key))}>×</button>
          </div>
        ))}
        {Array.from({ length: uploading }, (_, i) => <div key={`u${i}`} className="bp-shot loading" aria-label="Uploading" />)}
        {photos.length + uploading < 6 && (
          photosOn ? (
            <button type="button" className="bp-add" onClick={() => file.current?.click()}>+ Photo</button>
          ) : (
            <span className="bp-add off" title="Photo uploads are paused right now">+ Photo · soon</span>
          )
        )}
        <input ref={file} type="file" accept="image/jpeg,image/png,image/webp" multiple hidden onChange={(e) => add(e.target.files)} />
      </div>
      {(ai || checking) && (
        <div className={`bp-ai ${ai?.tone ?? "info"}`} role="status">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8z" /><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z" /></svg>
          <p>{checking && !ai ? "AI check: looking at your photos and the seller…" : ai?.note}</p>
        </div>
      )}
      <label className="bp-set">
        <div>
          <b>Stay anonymous to E‑Cinema staff too</b>
          <small>Only the investigator sees your name</small>
        </div>
        <input type="checkbox" role="switch" checked={anon} onChange={(e) => setAnon(e.target.checked)} />
        <span className="bp-toggle" aria-hidden />
      </label>
      {err && <p className="vf-err" role="alert">{err}</p>}
      <button className="vf-btn red big" disabled={busy || uploading > 0}>{busy ? "Sending" : "Send report"}</button>
    </form>
  );
}
