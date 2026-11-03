"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { SettingsData } from "@/lib/exec";
import { countryName } from "@/lib/worldmap";

// Executive settings (Figma 83:386). Payment switches take a method out of every checkout at
// once; security switches apply to the executive area. Every change lands in the audit log.
type Row = { key?: string; title: string; sub: string; soon?: string };
const PAYMENTS: Row[] = [
  { key: "pay.paystack", title: "Paystack", sub: "Nigeria · card, bank, USSD, transfer, billed in naira" },
  { key: "pay.flutterwave", title: "Flutterwave", sub: "Nigeria, Kenya, Ghana, Uganda, Tanzania · cards, bank, mobile money" },
  { key: "pay.paypal", title: "PayPal", sub: "Every country · tickets, plans and shop, cards through PayPal" },
  { title: "Stripe", sub: "Europe, UK, Americas, Asia · cards, Apple Pay, Google Pay", soon: "Not connected yet" },
  { title: "Pay with airtime", sub: "Mobile carrier billing", soon: "Needs a carrier partner" },
  { key: "pay.cod", title: "Cash on delivery", sub: "Shop only · Lagos" },
];
const SECURITY: Row[] = [
  { key: "sec.strong", title: "Passkey and face for every executive", sub: "Executives without a passkey and a finished face check cannot open this area" },
  { title: "Two-person approval", sub: "Payouts, price changes and access grants need a second cabinet member", soon: "Soon" },
  { title: "Block screen capture", sub: "Android and TV apps", soon: "Comes with the apps" },
  { title: "One account per face", sub: "Stops shared and duplicate accounts", soon: "Soon" },
  { key: "sec.timeout", title: "Session timeout", sub: "Executives signed out after 15 minutes idle" },
];
const NAMES: Record<string, string> = Object.fromEntries([...PAYMENTS, ...SECURITY, { key: "company.support", title: "Support email" }].filter((r) => r.key).map((r) => [r.key!, r.title]));
const show = (v: unknown) => (v === true ? "on" : v === false ? "off" : String(v ?? "–"));

type Country = { country: string; members: number; currency: string; methods: string[] };

export default function ExecSettings({ d, countries, configured }: { d: SettingsData; countries: Country[]; configured: { paypal: boolean; paystack: boolean; flutterwave: boolean; live: boolean } }) {
  const router = useRouter();
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [support, setSupport] = useState(String(d.values["company.support"] ?? ""));
  const [audit, setAudit] = useState(false);

  async function save(key: string, value: boolean | string) {
    setBusy(key); setMsg(null);
    const r = await fetch("/api/executive/settings", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ key, value }) }).catch(() => null);
    const b = (await r?.json().catch(() => ({}))) as { error?: string };
    setBusy("");
    setMsg(r?.ok ? { ok: true, text: `${NAMES[key] ?? key} ${typeof value === "boolean" ? `switched ${value ? "on" : "off"}` : "saved"}.` } : { ok: false, text: b.error ?? "Could not save it" });
    router.refresh();
  }

  const missing = (key?: string) => (key === "pay.paypal" && !configured.paypal) || (key === "pay.paystack" && !configured.paystack) || (key === "pay.flutterwave" && !configured.flutterwave);
  const toggle = (r: Row) => {
    if (r.soon) return <span className="exst-soon"><small className="exsec-soon">{r.soon}</small><button type="button" className="st-toggle" role="switch" aria-checked="false" aria-label={r.title} disabled><i /></button></span>;
    const on = d.values[r.key!] !== false;
    return (
      <span className="exst-soon">
        {missing(r.key) && <small className="exsec-soon">No key yet</small>}
        <button type="button" className={`st-toggle ${on ? "on" : ""}`} role="switch" aria-checked={on} aria-label={r.title} disabled={busy === r.key} onClick={() => save(r.key!, !on)}><i /></button>
      </span>
    );
  };
  const rows = (list: Row[]) => list.map((r) => (
    <div key={r.title} className="exst-row"><div><b>{r.title}</b><small>{r.sub}</small></div>{toggle(r)}</div>
  ));

  return (
    <section className="exc exst">
      <header className="exc-head">
        <div>
          <h1>Settings</h1>
          <p className="exc-sub">Platform-wide switches. Only you can change them, and every change is written to the audit log.</p>
        </div>
        <button type="button" className="exa-ghost" onClick={() => setAudit(true)}>View audit log</button>
      </header>
      {msg && <p className={msg.ok ? "exnt-ok" : "epf-err"} role="status">{msg.text}</p>}

      <div className="exst-grid">
        <div className="exc-card"><h2>Payments</h2>{rows(PAYMENTS)}<p className="exst-note">{configured.live ? "PayPal is taking live payments." : "PayPal runs in sandbox (test) mode until you switch payments to live."}</p></div>
        <div className="exc-card exst-sec"><h2>Security</h2>{rows(SECURITY)}{!d.strong && <p className="exst-note">Add a passkey and finish your face check before switching on the passkey rule, so you cannot lock yourself out.</p>}</div>
        <div className="exc-card">
          <h2>Countries</h2>
          {countries.length === 0 ? <p className="exc-empty">No members with a home country yet.</p> : (
            <div className="exrc-table exst-table" role="table">
              <div className="exrc-tr exrc-th" role="row"><span>Country</span><span>Members</span><span>Currency</span><span>Payments</span></div>
              {countries.map((c) => (
                <div key={c.country} className="exrc-tr" role="row"><span>{countryName(c.country)}</span><span>{c.members.toLocaleString("en-US")}</span><span>{c.currency}</span><span>{c.methods.join(", ") || "None switched on"}</span></div>
              ))}
            </div>
          )}
          <p className="exst-note">Where members live, the currency plans are billed in, and the payment methods checkout offers there right now.</p>
        </div>
        <form className="exc-card" onSubmit={(e) => { e.preventDefault(); void save("company.support", support.trim()); }}>
          <h2>Company</h2>
          <label className="epf-f"><span>Company name</span><input value="Online Cinema Ltd, trading as E-Cinema · RC 9947766" readOnly /></label>
          <label className="epf-f"><span>Support email (shown in the site footer)</span><input type="email" required maxLength={120} value={support} onChange={(e) => setSupport(e.target.value)} /></label>
          <label className="epf-f"><span>Domain</span><input value="e-cinema.net · live" readOnly /></label>
          <div className="epf-acts"><button type="submit" className="exa-red" disabled={busy === "company.support" || support.trim() === d.values["company.support"]}>Save</button><button type="button" className="exa-ghost" onClick={() => setSupport(String(d.values["company.support"] ?? ""))}>Cancel</button></div>
        </form>
      </div>

      {audit && (
        <div className="exa-scrim" role="dialog" aria-modal="true" aria-labelledby="exst-at" onClick={(e) => e.target === e.currentTarget && setAudit(false)}>
          <div className="exa-dialog">
            <div className="exa-dh"><h2 id="exst-at">Audit log</h2><span>CEO only</span></div>
            {d.audit.length === 0 ? <p className="exc-empty">No changes yet.</p> : (
              <ul className="exst-log">
                {d.audit.map((a, i) => (
                  <li key={i}><b>{NAMES[a.key] ?? a.key}</b> {show(a.old)} → {show(a.new)}<small>{a.actor} · {new Date(a.at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Africa/Lagos" })} WAT</small></li>
                ))}
              </ul>
            )}
            <div className="epf-acts"><button type="button" className="exa-ghost" onClick={() => setAudit(false)}>Close</button></div>
          </div>
        </div>
      )}
    </section>
  );
}
