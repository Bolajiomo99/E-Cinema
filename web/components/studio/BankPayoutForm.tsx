"use client";
import { useEffect, useState } from "react";
import { scall } from "./scall";

// Bank account for studio payouts (Studio / Revenue and payouts, "Bank transfer"). Banks come
// from Flutterwave; Nigerian accounts are checked with the bank, which fills in the name.
type Bank = { code: string; name: string };
const COUNTRIES: [string, string][] = [["NG", "Nigeria"], ["GH", "Ghana"], ["KE", "Kenya"], ["UG", "Uganda"], ["TZ", "Tanzania"], ["ZA", "South Africa"]];

export default function BankPayoutForm({ initial, onSaved, onCancel }: {
  initial?: { country?: string; bankCode?: string; number?: string; name?: string };
  onSaved: () => void; onCancel?: () => void;
}) {
  const [country, setCountry] = useState(initial?.country || "NG");
  const [banks, setBanks] = useState<Bank[] | null>(null);
  const [currency, setCurrency] = useState("NGN");
  const [resolve, setResolve] = useState(true);
  const [code, setCode] = useState(initial?.bankCode ?? "");
  const [number, setNumber] = useState(initial?.number ?? "");
  const [name, setName] = useState(initial?.name ?? "");
  const [checked, setChecked] = useState(Boolean(initial?.name));
  const [checking, setChecking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    let on = true;
    setBanks(null); setErr("");
    scall<{ banks: Bank[]; currency: string; resolve: boolean }>("GET", `banks/${country}`)
      .then((r) => { if (on) { setBanks(r.banks); setCurrency(r.currency); setResolve(r.resolve); } })
      .catch((e) => { if (on) { setBanks([]); setErr((e as Error).message); } });
    return () => { on = false; };
  }, [country]);

  // Ask the bank for the account name once the number and bank are both in.
  useEffect(() => {
    if (!resolve || !code || !/^[0-9]{10}$/.test(number)) return;
    let on = true;
    setChecking(true); setErr(""); setChecked(false);
    const t = setTimeout(() => {
      scall<{ name: string }>("POST", "banks/resolve", { bankCode: code, number })
        .then((r) => { if (on) { setName(r.name); setChecked(true); } })
        .catch((e) => { if (on) { setName(""); setErr((e as Error).message); } })
        .finally(() => { if (on) setChecking(false); });
    }, 400);
    return () => { on = false; clearTimeout(t); };
  }, [code, number, resolve]);

  const bank = banks?.find((b) => b.code === code);
  const ready = Boolean(bank && number && name.trim() && (!resolve || checked));

  async function save() {
    if (!bank) return;
    setBusy(true); setErr("");
    try {
      await scall("PUT", "payout", { method: "bank", bank: bank.name, bankCode: bank.code, number, name: name.trim(), currency });
      onSaved();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }

  return (
    <form className="pt-form bank-form" onSubmit={(e) => { e.preventDefault(); if (ready) void save(); }}>
      <label className="vf-field"><span>Country of the account</span><div className="vf-box">
        <select value={country} onChange={(e) => { setCountry(e.target.value); setCode(""); setName(""); setChecked(false); }}>
          {COUNTRIES.map(([c, n]) => <option key={c} value={c}>{n}</option>)}
        </select>
      </div></label>
      <label className="vf-field"><span>Bank</span><div className="vf-box">
        <select value={code} disabled={!banks?.length} onChange={(e) => { setCode(e.target.value); setChecked(false); if (resolve) setName(""); }} required>
          <option value="">{banks ? (banks.length ? "Pick your bank" : "No banks listed") : "Loading banks"}</option>
          {banks?.map((b) => <option key={b.code} value={b.code}>{b.name}</option>)}
        </select>
      </div></label>
      <label className="vf-field"><span>Account number</span><div className="vf-box">
        <input inputMode="numeric" value={number} required maxLength={resolve ? 10 : 34} placeholder={resolve ? "10 digits" : "Account number"}
          onChange={(e) => { setNumber(e.target.value.replace(resolve ? /\D/g : /[^0-9A-Za-z ]/g, "").toUpperCase()); setChecked(false); if (resolve) setName(""); }} />
      </div></label>
      <label className="vf-field"><span>Account name</span><div className="vf-box">
        <input value={checking ? "Checking with the bank" : name} readOnly={resolve} required maxLength={120}
          placeholder={resolve ? "Filled in by the bank" : "Name on the account"} onChange={(e) => setName(e.target.value)} />
      </div></label>
      {checked && resolve && <p className="pt-hint bank-ok">The bank confirmed this account is in the name of {name}.</p>}
      <p className="pt-hint">Paid in {currency} at Flutterwave&apos;s transfer rate after each premiere ends.</p>
      {err && <p className="vf-err" role="alert">{err}</p>}
      <div className="pt-btns">
        <button className="vf-btn red sm" disabled={busy || !ready}>{busy ? "Saving" : "Save bank account"}</button>
        {onCancel && <button type="button" className="vf-btn sm ghost" onClick={onCancel}>Cancel</button>}
      </div>
    </form>
  );
}
