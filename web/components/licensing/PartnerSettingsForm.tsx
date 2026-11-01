"use client";
import { useState } from "react";
import { pcall } from "./pcall";

export default function PartnerSettingsForm({ city: c0, website: w0, owner }: { city: string; website: string; owner: boolean }) {
  const [city, setCity] = useState(c0);
  const [website, setWebsite] = useState(w0);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  return (
    <form className="pt-form" onSubmit={async (e) => {
      e.preventDefault();
      setBusy(true); setErr(""); setMsg("");
      try { await pcall("PUT", "partner/settings", { city, website }); setMsg("Saved."); } catch (x) { setErr((x as Error).message); } finally { setBusy(false); }
    }}>
      <div className="ap-row">
        <label className="vf-field"><span>City</span><div className="vf-box"><input value={city} onChange={(e) => setCity(e.target.value)} maxLength={80} disabled={!owner} /></div></label>
        <label className="vf-field"><span>Website or shop</span><div className="vf-box"><input value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="yourshop.ng" maxLength={120} disabled={!owner} /></div></label>
      </div>
      {msg && <p className="bp-flash" role="status">{msg}</p>}
      {err && <p className="vf-err" role="alert">{err}</p>}
      {owner && <div className="ap-act"><span /><button className="vf-btn red" disabled={busy}>{busy ? "Saving" : "Save"}</button></div>}
    </form>
  );
}
