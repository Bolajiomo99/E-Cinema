"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { AdultRecipient, RecipientsData } from "@/lib/exec";
import { COUNTRIES, countryName } from "@/lib/worldmap";

// 18+ recipients (Figma 49:1577 page, 99:1362 add dialog). CEO only. Viewers pick one active
// recipient of the right kind for each of the first three 18+ unlock payments.
type Kind = AdultRecipient["kind"];
const KINDS: { k: Kind; one: string; many: string; fund: string }[] = [
  { k: "charity", one: "Charity", many: "Charities", fund: "verified charities" },
  { k: "pastor", one: "Pastor", many: "Pastors", fund: "verified churches" },
  { k: "cleric", one: "Cleric", many: "Clerics", fund: "verified mosques" },
];
type Tab = Kind | "pending" | "paused";
type Form = { id: string; kind: Kind; name: string; regNumber: string; country: string; city: string; bank: string; bankCode: string; accountNo: string; accountName: string; accountLast: string; note: string; on: boolean; status: string };
const blank = (kind: Kind = "charity"): Form => ({ id: "", kind, name: "", regNumber: "", country: "NG", city: "", bank: "", bankCode: "", accountNo: "", accountName: "", accountLast: "", note: "", on: false, status: "pending" });
const usd = (cents: number) => `$${Math.round(cents / 100).toLocaleString("en-US")}`;
const COUNTRY_LIST = Object.entries(COUNTRIES).map(([cc, c]) => [cc, c.name] as const).sort((a, b) => a[1].localeCompare(b[1]));
const PLACE: Record<Kind, string> = { charity: "Hope Children's Home, Ibadan", pastor: "Pastor Emmanuel Obi · Grace Chapel", cleric: "Imam Sani Lawal · Central Mosque" };

export default function ExecRecipients({ d, paid, received }: { d: RecipientsData; paid: Record<Kind | "access", number>; received: Record<string, number> }) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("charity");
  const [form, setForm] = useState<Form | null>(null);
  const [quick, setQuick] = useState<Form>(blank("pastor"));
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const live = (k: Kind) => d.recipients.filter((r) => r.kind === k && r.status === "active");
  const count: Record<Tab, number> = {
    charity: d.recipients.filter((r) => r.kind === "charity").length,
    pastor: d.recipients.filter((r) => r.kind === "pastor").length,
    cleric: d.recipients.filter((r) => r.kind === "cleric").length,
    pending: d.recipients.filter((r) => r.status === "pending").length,
    paused: d.recipients.filter((r) => r.status === "paused").length,
  };
  const rows = d.recipients.filter((r) => (tab === "pending" || tab === "paused" ? r.status === tab : r.kind === tab));
  const title = tab === "pending" ? "Pending review" : tab === "paused" ? "Paused" : KINDS.find((x) => x.k === tab)!.many;

  async function toggle(r: AdultRecipient) {
    setBusy(r.id); setErr("");
    const res = await fetch(`/api/executive/recipients/${r.id}/status`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ status: r.status === "active" ? "paused" : "active" }) }).catch(() => null);
    const b = (await res?.json().catch(() => ({}))) as { error?: string };
    setBusy("");
    if (!res?.ok) { setErr(b.error ?? "Could not change it"); return; }
    router.refresh();
  }
  const edit = (r: AdultRecipient) => setForm({ ...blank(r.kind), ...r, bankCode: "", accountNo: "", on: r.status === "active", status: r.status });

  return (
    <section className="exc exrc">
      <header className="exc-head">
        <div>
          <h1>18+ recipients</h1>
          <p className="exc-sub">Viewers pick one recipient for each of the first three payments from this list. Only you can add, pause or remove a recipient.</p>
        </div>
        <div className="exrc-hacts"><span className="exrc-ceo">CEO ONLY</span><button type="button" className="exa-red" onClick={() => { setErr(""); setForm(blank()); }}>Add recipient</button></div>
      </header>

      <div className="exc-tiles exrc-tiles">
        {KINDS.map((x) => (
          <div key={x.k} className="exc-tile"><span>Paid to {x.many.toLowerCase()} (30 days)</span><b>{usd(paid[x.k])}</b><small className="up">{x.k === "charity" ? `${d.unlocks30.toLocaleString("en-US")} unlock payments` : `${live(x.k).length} ${x.fund}`}</small></div>
        ))}
        <div className="exc-tile"><span>Access payments (E-Cinema)</span><b>{usd(paid.access)}</b><small className="up">in viewers&apos; local currency</small></div>
      </div>

      <div className="exprt-chips exrc-tabs" role="tablist">
        {(["charity", "pastor", "cleric", "pending", "paused"] as Tab[]).map((t) => (
          <button key={t} type="button" role="tab" aria-selected={tab === t} className={`exprt-chip ${tab === t ? "on" : ""}`} onClick={() => setTab(t)}>
            {t === "pending" ? "Pending review" : t === "paused" ? "Paused" : KINDS.find((x) => x.k === t)!.many} {count[t]}
          </button>
        ))}
      </div>

      <div className="exc-card">
        <h2>{title}</h2>
        {err && <p className="epf-err" role="alert">{err}</p>}
        {rows.length === 0 ? (
          <p className="exc-empty">{tab === "pending" || tab === "paused" ? `Nobody is ${title.toLowerCase()}.` : `No ${title.toLowerCase()} yet. Until one is active, viewers pay this stage to the E-Cinema fund.`}</p>
        ) : (
          <div className="exrc-table" role="table">
            <div className="exrc-tr exrc-th" role="row"><span role="columnheader">Recipient</span><span role="columnheader">Country</span><span role="columnheader">Verification</span><span role="columnheader">Received (30 d)</span><span role="columnheader">Active</span><span /></div>
            {rows.map((r) => (
              <div key={r.id} className="exrc-tr" role="row">
                <span role="cell" className="exrc-who"><i aria-hidden><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round"><path d="M12 20s-7-4.5-7-10a4 4 0 0 1 7-2.5A4 4 0 0 1 19 10c0 5.5-7 10-7 10z" /></svg></i><span><b>{r.name}</b><small>{[r.city, countryName(r.country)].filter(Boolean).join(", ")}{tab === "pending" || tab === "paused" ? ` · ${KINDS.find((x) => x.k === r.kind)!.one}` : ""}</small></span></span>
                <span role="cell">{countryName(r.country)}</span>
                <span role="cell" className={r.status === "active" ? "exrc-ok" : "exrc-wait"}>{r.status === "active" ? `Active · ${r.bank || "bank"} ••${r.accountLast}` : r.status === "paused" ? "Paused" : r.accountLast ? "Pending · bank on file" : "Pending · needs bank account"}</span>
                <span role="cell">{received[r.id] >= 0 ? usd(received[r.id]) : "–"}</span>
                <span role="cell"><button type="button" className={`st-toggle ${r.status === "active" ? "on" : ""}`} role="switch" aria-checked={r.status === "active"} aria-label={`${r.name} active`} disabled={busy === r.id} onClick={() => toggle(r)}><i /></button></span>
                <span role="cell"><button type="button" className="exa-ghost exrc-edit" onClick={() => edit(r)}>Edit</button></span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="exc-row exrc-row">
        <form className="exc-card" onSubmit={(e) => { e.preventDefault(); setErr(""); setForm({ ...quick }); }}>
          <h2>Add a recipient</h2>
          <div className="epf-two">
            <label className="epf-f"><span>Type</span><select value={quick.kind} onChange={(e) => setQuick({ ...quick, kind: e.target.value as Kind })}><option value="charity">Charity</option><option value="pastor">Church pastor</option><option value="cleric">Mosque cleric</option></select></label>
            <label className="epf-f"><span>Name</span><input value={quick.name} maxLength={120} onChange={(e) => setQuick({ ...quick, name: e.target.value })} placeholder={PLACE[quick.kind]} /></label>
            <label className="epf-f"><span>Country</span><select value={quick.country} onChange={(e) => setQuick({ ...quick, country: e.target.value })}>{COUNTRY_LIST.map(([cc, n]) => <option key={cc} value={cc}>{n}</option>)}</select></label>
            <label className="epf-f"><span>City</span><input value={quick.city} maxLength={80} onChange={(e) => setQuick({ ...quick, city: e.target.value })} placeholder="Enugu" /></label>
          </div>
          <button type="submit" className="exa-red">Verify and add</button>
        </form>
        <div className="exc-card">
          <h2>How money reaches them</h2>
          <ol className="exrc-steps">
            <li><b>1</b>Viewer pays in their own currency through PayPal, with the recipient named on the payment</li>
            <li><b>2</b>E-Cinema holds it in a separate client account, never mixed with revenue <small className="exsec-soon">Soon</small></li>
            <li><b>3</b>Paid out weekly to the recipient&apos;s verified bank account <small className="exsec-soon">Soon</small></li>
            <li><b>4</b>Every viewer gets a receipt naming the recipient</li>
            <li><b>5</b>AI flags unusual patterns, such as one account paying the same recipient many times <small className="exsec-soon">Soon</small></li>
          </ol>
        </div>
      </div>

      {form && <RecipientDialog form={form} setForm={setForm} onDone={() => { setForm(null); setQuick(blank("pastor")); router.refresh(); }} />}
    </section>
  );
}

function RecipientDialog({ form, setForm, onDone }: { form: Form; setForm: (f: Form | null) => void; onDone: () => void }) {
  const [banks, setBanks] = useState<{ name: string; code: string }[] | null>(null);
  const [check, setCheck] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const ng = form.country === "NG";
  useEffect(() => {
    if (!ng || banks) return;
    fetch("/api/executive/recipients/bank?list=1").then((r) => r.json()).then((b: { banks?: { name: string; code: string }[] }) => setBanks(b.banks ?? [])).catch(() => setBanks([]));
  }, [ng, banks]);
  const set = (p: Partial<Form>) => setForm({ ...form, ...p });

  async function lookup(code: string, acct: string) {
    if (!ng || !code || !/^[0-9]{10}$/.test(acct)) return;
    setCheck("Checking the account with the bank…");
    const r = await fetch(`/api/executive/recipients/bank?bank=${encodeURIComponent(code)}&account=${acct}`).catch(() => null);
    const b = (await r?.json().catch(() => ({}))) as { accountName?: string; error?: string };
    if (r?.ok && b.accountName) { setCheck(""); setForm({ ...form, bankCode: code, accountNo: acct, accountName: b.accountName }); } else setCheck(b.error ?? "The bank lookup did not answer.");
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr("");
    const status = form.on ? "active" : form.status === "paused" ? "paused" : "pending";
    const r = await fetch("/api/executive/recipients", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...form, status }) }).catch(() => null);
    const b = (await r?.json().catch(() => ({}))) as { error?: string };
    setBusy(false);
    if (!r?.ok) { setErr(b.error ?? "Could not save"); return; }
    onDone();
  }

  const canOn = Boolean(form.bank && (form.accountNo || form.accountLast));
  return (
    <div className="exa-scrim" role="dialog" aria-modal="true" aria-labelledby="exrc-dt" onClick={(e) => e.target === e.currentTarget && setForm(null)}>
      <form className="exa-dialog exrc-dialog" onSubmit={save}>
        <div className="exa-dh"><h2 id="exrc-dt">{form.id ? "Edit 18+ recipient" : "Add an 18+ recipient"}</h2><span>CEO only</span></div>
        <p className="exc-sub">18+ unlock payments go only to recipients on this list. Only the CEO can add, pause or remove them.</p>
        <div className="epf-f"><span>Type</span>
          <div className="exprt-chips exrc-kind">{KINDS.map((x) => <button key={x.k} type="button" className={`exprt-chip ${form.kind === x.k ? "on" : ""}`} aria-pressed={form.kind === x.k} onClick={() => set({ kind: x.k })}>{x.one}</button>)}</div>
        </div>
        <label className="epf-f"><span>Name</span><input required minLength={3} maxLength={120} value={form.name} onChange={(e) => set({ name: e.target.value })} placeholder={PLACE[form.kind]} /></label>
        <div className="epf-two">
          <label className="epf-f"><span>Registration number</span><input maxLength={60} value={form.regNumber} onChange={(e) => set({ regNumber: e.target.value })} placeholder="CAC/IT/123456" /></label>
          <label className="epf-f"><span>Country</span><select value={form.country} onChange={(e) => set({ country: e.target.value, bank: "", bankCode: "", accountName: "" })}>{COUNTRY_LIST.map(([cc, n]) => <option key={cc} value={cc}>{n}</option>)}</select></label>
        </div>
        <label className="epf-f"><span>City</span><input maxLength={80} value={form.city} onChange={(e) => set({ city: e.target.value })} placeholder="Ibadan" /></label>
        <div className="epf-two">
          <label className="epf-f"><span>Bank</span>
            {ng && banks && banks.length > 0 ? (
              <select value={form.bankCode} onChange={(e) => { const b = banks.find((x) => x.code === e.target.value); setForm({ ...form, bankCode: e.target.value, bank: b?.name ?? "", accountName: "" }); lookup(e.target.value, form.accountNo); }}>
                <option value="">{form.bank && !form.bankCode ? form.bank : "Choose a bank"}</option>
                {banks.map((b) => <option key={`${b.code}-${b.name}`} value={b.code}>{b.name}</option>)}
              </select>
            ) : <input maxLength={80} value={form.bank} onChange={(e) => set({ bank: e.target.value })} placeholder="Access Bank" />}
          </label>
          <label className="epf-f"><span>Account number{form.accountLast && !form.accountNo ? ` (on file ••${form.accountLast})` : ""}</span><input inputMode="numeric" maxLength={20} value={form.accountNo} onChange={(e) => { const v = e.target.value.replace(/\D/g, ""); setForm({ ...form, accountNo: v, accountName: ng ? "" : form.accountName }); if (v.length === 10) lookup(form.bankCode, v); }} placeholder={form.accountLast ? "Leave empty to keep it" : "0123456789"} /></label>
        </div>
        {!ng && <label className="epf-f"><span>Account name</span><input maxLength={120} value={form.accountName} onChange={(e) => set({ accountName: e.target.value })} /></label>}
        <div className="exrc-checks">
          {ng && form.accountName && form.accountNo ? <p><span className="y">✓</span>Account name from the bank: {form.accountName}</p> : ng ? <p><span className="n">○</span>{check || "Pick the bank and type the 10-digit account number to check the name"}</p> : <p><span className="n">○</span>Bank name checks run for Nigerian accounts only for now</p>}
          <p><span className="n">○</span>Registration check in the CAC register <small className="exsec-soon">Soon</small></p>
        </div>
        <label className="epf-f"><span>Note (only you see it)</span><input maxLength={300} value={form.note} onChange={(e) => set({ note: e.target.value })} /></label>
        <label className="exrc-on"><input type="checkbox" checked={form.on && canOn} disabled={!canOn} onChange={(e) => set({ on: e.target.checked })} /> Viewers can pick them now{!canOn && " (add their bank account first)"}</label>
        {err && <p className="epf-err" role="alert">{err}</p>}
        <div className="epf-acts"><small className="exrc-face">Confirm with face check <span className="exsec-soon">Soon</span></small><button type="button" className="exa-ghost" onClick={() => setForm(null)}>Cancel</button><button type="submit" className="exa-red" disabled={busy}>{busy ? "Saving…" : form.id ? "Save changes" : "Add recipient"}</button></div>
      </form>
    </div>
  );
}
