"use client";
import { useState } from "react";

const KINDS: [string, string][] = [["company", "Company"], ["school", "School or university"], ["faith", "Church or mosque"], ["brand", "Brand sponsorship"]];

// "Get a quote" (Figma 94:1239): the request goes to the sales inbox and the sales list.
export default function QuoteForm({ country, countries }: { country: string; countries: [string, string][] }) {
  const [f, setF] = useState({ organisation: "", email: "", guests: "", country, kind: "company", note: "" });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF((v) => ({ ...v, [k]: e.target.value }));
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setMsg(null);
    const r = await fetch("/api/careers/quote", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...f, guests: Number(f.guests.replace(/[^\d]/g, "")) }) });
    const b = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) return setMsg({ ok: false, text: b.error ?? "Could not send. Try again." });
    setMsg({ ok: true, text: "Thank you. Our sales team will reply to your work email within one working day." });
    setF((v) => ({ ...v, organisation: "", guests: "", note: "" }));
  }
  return (
    <form className="qf" onSubmit={submit}>
      <label><span>Organisation</span><input required maxLength={120} value={f.organisation} onChange={set("organisation")} autoComplete="organization" /></label>
      <label><span>Work email</span><input required type="email" maxLength={200} value={f.email} onChange={set("email")} autoComplete="email" /></label>
      <label><span>Guests</span><input required inputMode="numeric" maxLength={7} value={f.guests} onChange={set("guests")} placeholder="2,000" /></label>
      <label><span>Country</span>
        <select required value={f.country} onChange={set("country")}><option value="">Choose a country</option>{countries.map(([c, n]) => <option key={c} value={c}>{n}</option>)}</select>
      </label>
      <label><span>Kind of screening</span>
        <select value={f.kind} onChange={set("kind")}>{KINDS.map(([k, t]) => <option key={k} value={k}>{t}</option>)}</select>
      </label>
      <label className="qf-wide"><span>Anything else (optional)</span><textarea rows={3} maxLength={1000} value={f.note} onChange={set("note")} placeholder="Film, date, logo, who pays for seats" /></label>
      <div className="qf-wide qf-row">
        <button className="vf-btn red" type="submit" disabled={busy}>{busy ? "Sending…" : "Send request"}</button>
        {msg && <span className={`rf-note ${msg.ok ? "ok" : "bad"}`} role="status">{msg.text}</span>}
      </div>
    </form>
  );
}
