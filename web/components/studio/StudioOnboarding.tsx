"use client";
import { useRouter } from "next/navigation";
import { useRef, useState, type ReactNode } from "react";
import FaceCheck from "@/components/FaceCheck";
import Logo from "@/components/landing/Logo";
import type { Steps, Studio } from "@/lib/studio-types";
import { scall } from "./scall";
import BankPayoutForm from "./BankPayoutForm";

// Figma "Studio / Onboarding · verify studio and rights" (34:49). The four checks each open in
// place; Continue saves the studio, then sends it to our studio team once every check is done.
type Mine = { studio: Studio | null; steps: Steps; identityOk: boolean };
type Open = "" | "docs" | "payout" | "rights" | "terms" | "face";

const TICK = <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="#0a0a0c" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="m5 12.5 4.5 4.5L19 7.5" /></svg>;
const DOC = <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="#a6a6b0" strokeWidth="1.8" strokeLinejoin="round" aria-hidden><path d="M7 3h7l4 4v14H7z" /></svg>;

function Step({ done, title, text, action, open, children }: { done: boolean; title: string; text: string; action: ReactNode; open: boolean; children?: ReactNode }) {
  return (
    <div className={`stuo-step ${done ? "done" : ""} ${open ? "open" : ""}`}>
      <div className="stuo-row">
        <span className="stuo-n">{done ? TICK : DOC}</span>
        <div className="stuo-t"><b>{title}</b><small>{text}</small></div>
        {action}
      </div>
      {open && <div className="stuo-body">{children}</div>}
    </div>
  );
}

export default function StudioOnboarding({ initial, countries, home }: { initial: Mine; countries: [string, string][]; home: string }) {
  const router = useRouter();
  const [m, setM] = useState(initial);
  const st = m.studio;
  const [name, setName] = useState(st?.name ?? "");
  const [country, setCountry] = useState(st?.regCountry || home);
  const [number, setNumber] = useState(st?.regNumber ?? "");
  const [city, setCity] = useState(st?.city ?? "");
  const [open, setOpen] = useState<Open>("");
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const [note, setNote] = useState("");
  const [via, setVia] = useState<"paypal" | "bank">(st?.payoutMethod === "bank" ? "bank" : "paypal");
  const [paypal, setPaypal] = useState(st?.payoutEmail && !st.payoutEmail.startsWith("payouts+") ? st.payoutEmail : "");
  const [rights, setRights] = useState(st?.rightsNote ?? "");
  const [agree, setAgree] = useState(Boolean(st?.termsAt));
  const file = useRef<HTMLInputElement>(null);

  const locked = st?.status === "submitted";
  const allDone = m.steps.docs && m.steps.payout && m.steps.rights && m.steps.terms;
  const dirty = !st || name !== st.name || country !== st.regCountry || number !== st.regNumber || city !== st.city;

  async function run(tag: string, fn: () => Promise<Partial<Mine> & { note?: string }>) {
    setBusy(tag); setErr("");
    try {
      const r = await fn();
      setM((cur) => ({ studio: r.studio ?? cur.studio, steps: r.steps ?? cur.steps, identityOk: r.identityOk ?? cur.identityOk }));
      if (r.note) setNote(r.note);
      return true;
    } catch (e) { setErr((e as Error).message); return false; } finally { setBusy(""); }
  }
  const save = () => run("save", () => scall("PUT", "", { name, regCountry: country, regNumber: number, city, legalName: name }));
  const toggle = (o: Open) => { setErr(""); setOpen((c) => (c === o ? "" : o)); };

  async function onContinue() {
    if (dirty && !(await save())) return;
    if (!allDone) {
      const next: Open = !m.steps.docs ? "docs" : !m.steps.payout ? "payout" : !m.steps.rights ? "rights" : "terms";
      setOpen(next);
      return;
    }
    if (!m.identityOk) { setOpen("face"); return; }
    if (await run("submit", () => scall("POST", "submit"))) router.refresh();
  }

  const startBtn = (o: Open, done: boolean) => locked ? null : done
    ? <button type="button" className="stuo-badge" onClick={() => toggle(o)} aria-expanded={open === o}>{open === o ? "CLOSE" : "DONE"}</button>
    : <button type="button" className="vf-btn sm" disabled={!st} title={st ? undefined : "Save your studio name first"} onClick={() => toggle(o)} aria-expanded={open === o}>{open === o ? "Close" : "Start"}</button>;

  return (
    <div className="stuo">
      <div className="stuo-art">
        <div className="stuo-brand"><Logo href="/home" /><b>STUDIO</b></div>
        <div className="stuo-copy">
          <h2>PREMIERE TO THE<br />WHOLE WORLD<br />IN ONE NIGHT</h2>
          <p>Upload once. AI dubs it into 40+ languages. You set prices per country and keep 70% of every ticket.</p>
        </div>
      </div>
      <form className="stuo-form" onSubmit={(e) => { e.preventDefault(); onContinue(); }}>
        <h1>Set up your studio</h1>
        <p className="stuo-lead">Studios license and upload their own films. We check who you are and that you hold the rights before your first premiere.</p>

        {st?.status === "submitted" && <p className="bp-flash" role="status">Thanks. Our studio team is checking {st.name}. We email you as soon as it is verified, usually within two working days.</p>}
        {st?.status === "rejected" && <p className="bp-flash warn" role="status">We could not verify {st.name} yet: {st.reviewNote || "please check your details"}. Fix what is needed below and continue to send it again.</p>}

        <div className="stuo-grid">
          <label className="vf-field"><span>Studio name</span><div className="vf-box"><input value={name} onChange={(e) => setName(e.target.value)} placeholder="Starlight Pictures Ltd" maxLength={80} required minLength={2} disabled={locked} autoComplete="organization" /></div></label>
          <label className="vf-field"><span>Country of registration</span><div className="vf-box"><select value={country} onChange={(e) => setCountry(e.target.value)} disabled={locked}>{countries.map(([c, n]) => <option key={c} value={c}>{n}</option>)}</select></div></label>
          <label className="vf-field"><span>Registration number</span><div className="vf-box"><input value={number} onChange={(e) => setNumber(e.target.value)} placeholder="RC 1849302" maxLength={40} disabled={locked} /></div></label>
          <label className="vf-field"><span>City</span><div className="vf-box"><input value={city} onChange={(e) => setCity(e.target.value)} placeholder="Lagos" maxLength={60} disabled={locked} autoComplete="address-level2" /></div></label>
        </div>

        <Step done={m.steps.docs} open={open === "docs"} title="Company documents" text="Certificate of incorporation and directors' IDs. AI reads and checks them in minutes." action={startBtn("docs", m.steps.docs)}>
          <p className="pt-hint">Upload your certificate of incorporation as a PDF, JPG or PNG (up to 12 MB). It is stored privately and only our studio team can open it.</p>
          <input ref={file} type="file" accept="application/pdf,image/jpeg,image/png" hidden onChange={(e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            const fd = new FormData();
            fd.append("file", f);
            run("docs", () => scall("POST", "docs", fd));
            e.target.value = "";
          }} />
          <div className="pt-btns">
            <button type="button" className="vf-btn sm" disabled={busy === "docs"} onClick={() => file.current?.click()}>{busy === "docs" ? "Reading it" : m.steps.docs ? "Upload a different file" : "Choose file"}</button>
            {m.steps.docs && <button type="button" className="vf-btn sm ghost" onClick={async () => { try { const r = await scall<{ url: string }>("GET", "docs"); window.open(r.url, "_blank", "noopener"); } catch (x) { setErr((x as Error).message); } }}>View file</button>}
          </div>
          {(note || st?.docsOk) && <p className="pt-hint" role="status">{note || "Checked by AI"}</p>}
        </Step>

        <Step done={m.steps.payout} open={open === "payout"} title="Bank or payout account" text="Where your 70% share is paid, in your currency." action={startBtn("payout", m.steps.payout)}>
          <div className="ec-seg stu-seg" role="tablist" aria-label="How you are paid">
            <button type="button" role="tab" aria-selected={via === "paypal"} className={via === "paypal" ? "on" : ""} onClick={() => setVia("paypal")}>PayPal</button>
            <button type="button" role="tab" aria-selected={via === "bank"} className={via === "bank" ? "on" : ""} onClick={() => setVia("bank")}>Bank account</button>
          </div>
          {via === "bank" ? (
            <BankPayoutForm onSaved={() => void run("payout", () => scall("GET", "")).then((ok) => ok && setOpen(""))} />
          ) : <div className="pt-inline">
            <label className="vf-field"><span>PayPal email for payouts</span><div className="vf-box"><input type="email" value={paypal} onChange={(e) => setPaypal(e.target.value)} placeholder="finance@starlight.ng" maxLength={120} /></div></label>
            <button type="button" className="vf-btn red" disabled={busy === "payout" || !paypal} onClick={() => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(paypal.trim()) ? run("payout", () => scall("PUT", "payout", { method: "paypal", email: paypal.trim(), currency: "USD" })).then((ok) => ok && setOpen("")) : setErr("Enter the PayPal email address your share should go to")}>{busy === "payout" ? "Saving" : "Save"}</button>
          </div>}
          <p className="pt-hint">Your share of each premiere is sent automatically once it ends: in US dollars by PayPal, or in your currency by bank transfer.</p>
        </Step>

        <Step done={m.steps.rights} open={open === "rights"} title="Rights declaration" text="For each film: territories, languages and dates you hold rights for. AI flags conflicts with other studios." action={startBtn("rights", m.steps.rights)}>
          <label className="vf-field"><span>Your rights</span>
            <textarea className="stuo-area" value={rights} onChange={(e) => setRights(e.target.value)} rows={4} maxLength={4000} placeholder="Orbit Zero: worldwide streaming rights, all languages, 1 Oct 2026 to 30 Sep 2031. Owned outright by Starlight Pictures." />
          </label>
          <div className="pt-btns">
            <button type="button" className="vf-btn red sm" disabled={busy === "rights" || rights.trim().length < 20} onClick={() => run("rights", () => scall("PUT", "rights", { note: rights.trim() })).then((ok) => ok && setOpen(""))}>{busy === "rights" ? "Saving" : "Declare these rights"}</button>
          </div>
          <p className="pt-hint">This is a legal declaration that you own or license these rights. Per-film rights and conflict checks happen when you upload each film.</p>
        </Step>

        <Step done={m.steps.terms} open={open === "terms"} title="Content standards" text="Age ratings, content notes and our studio terms (30% platform fee)." action={startBtn("terms", m.steps.terms)}>
          <ul className="stuo-terms">
            <li>Every film carries an age rating and content notes before it goes on sale. Adult titles are shown as 18+ before anyone pays.</li>
            <li>You keep 70% of net ticket revenue. E‑Cinema keeps 30% for streaming, protection, dubbing and payments.</li>
            <li>No hate, no real-world sexual content involving minors, nothing you do not hold the rights to. We remove films that break this.</li>
            <li>Read the full <a href="/legal/studios" target="_blank" rel="noopener">studio terms</a>.</li>
          </ul>
          <label className="stuo-check"><input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} /> I agree to the content standards and studio terms on behalf of {st?.name || "my studio"}</label>
          <div className="pt-btns">
            <button type="button" className="vf-btn red sm" disabled={!agree || busy === "terms"} onClick={() => run("terms", () => scall("POST", "terms")).then((ok) => ok && setOpen(""))}>{busy === "terms" ? "Saving" : "Accept"}</button>
          </div>
        </Step>

        {(open === "face" || (allDone && !m.identityOk)) && (
          <Step done={m.identityOk} open={open === "face"} title="Your face and ID" text="We confirm the person running the studio is who they say. Takes about two minutes." action={<button type="button" className="vf-btn sm" onClick={() => toggle("face")}>{open === "face" ? "Close" : "Start"}</button>}>
            <FaceCheck onVerified={() => { setM((c) => ({ ...c, identityOk: true })); setOpen(""); }} />
          </Step>
        )}

        <div className="stuo-note">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="#d4a23a" aria-hidden><path d="M12 2l1.8 6.2L20 10l-6.2 1.8L12 18l-1.8-6.2L4 10l6.2-1.8z" /></svg>
          <p>E‑Cinema never edits or re-licenses your film. We host, protect, dub with your approval and pay you.</p>
        </div>
        {err && <p className="vf-err" role="alert">{err}</p>}
        {!locked && (
          <button className="vf-btn red big" disabled={!!busy}>
            {busy === "save" ? "Saving" : busy === "submit" ? "Sending" : !st || dirty ? (st ? "Save and continue" : "Continue") : allDone ? (m.identityOk ? "Send for verification" : "Verify your face and ID") : "Continue"}
          </button>
        )}
      </form>
    </div>
  );
}
