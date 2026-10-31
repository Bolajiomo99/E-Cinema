"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import FaceCheck from "@/components/FaceCheck";
import { GoogleButton, PasskeyButton, PasswordField } from "@/components/AuthForms";
import { countryName, currencyFor, money, PLANS, payMethods, priceOf, vatRate, type PlanId } from "@/lib/plans";

// Sign-up from Figma: 1 Account (16:127), 2 Verify (16:259), 3 Plan (29:417), 4 Pay (29:521).
export type Step = 1 | 2 | 3 | 4;
type Profile = { country?: string; contactPhone?: string; plan?: PlanId; planStatus?: string };
type Ready = { paypal: boolean; paystack: boolean; flutterwave: boolean; crypto: boolean };

export const LANGUAGES: [string, string][] = [
  ["en", "English"], ["yo", "Yorùbá"], ["ha", "Hausa"], ["ig", "Igbo"], ["fr", "Français"], ["hi", "हिन्दी"],
  ["ko", "한국어"], ["es", "Español"], ["pt", "Português"], ["de", "Deutsch"], ["ar", "العربية"], ["sw", "Kiswahili"],
];
const DIAL: Record<string, string> = { NG: "+234", GH: "+233", KE: "+254", ZA: "+27", GB: "+44", US: "+1", DE: "+49", FR: "+33", IN: "+91", KR: "+82" };

async function call(path: string, body: unknown, method = "POST") {
  const res = await fetch(path, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? "Something went wrong, please try again");
  return data;
}

function score(pw: string) {
  let s = 0;
  if (pw.length >= 10) s++;
  if (pw.length >= 14) s++;
  if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) s++;
  if (/\d/.test(pw) || /[^A-Za-z0-9]/.test(pw)) s++;
  return pw.length < 10 ? Math.min(s, 1) : s;
}
const STRENGTH = ["Too short", "Weak", "Fair", "Good", "Strong"];

export function Stepper({ at }: { at: Step }) {
  return (
    <ol className="su-steps" aria-label={`Step ${at} of 4`}>
      {["Account", "Verify", "Plan", "Pay"].map((s, i) => (
        <li key={s} className={i + 1 <= at ? "on" : ""} aria-current={i + 1 === at ? "step" : undefined}>
          <i />
          <span>{i + 1}. {s}</span>
        </li>
      ))}
    </ol>
  );
}

export default function JoinFlow({ step, country, profile, identityStatus, google, ready }: {
  step: Step; country?: string; profile?: Profile; identityStatus?: string; google: boolean; ready: Ready;
}) {
  const router = useRouter();
  const go = (s: Step) => router.push(`/join?step=${s}`);
  if (step === 1) return <AccountStep country={country} google={google} onDone={() => go(2)} />;
  if (step === 2) return <VerifyStep phone={profile?.contactPhone} identityStatus={identityStatus} onDone={() => go(3)} />;
  if (step === 3) return <PlanStep country={country} current={profile?.plan} onFree={() => { router.push("/home"); router.refresh(); }} onPaid={() => go(4)} />;
  return <PayStep country={country} plan={profile?.plan ?? "pro"} ready={ready} />;
}

function AccountStep({ country, google, onDone }: { country?: string; google: boolean; onDone: () => void }) {
  const [password, setPassword] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [termsError, setTermsError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const s = score(password);
  const dial = (country && DIAL[country]) || "+";
  return (
    <form
      className="su-form"
      onSubmit={async (e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        if (!agreed) return setTermsError(true);
        setBusy(true);
        setError("");
        try {
          const name = `${f.get("first")} ${f.get("last")}`.trim();
          await call("/api/auth/signup", { name, email: f.get("email"), password, terms: true });
          await call("/api/me/profile", {
            country, birthDate: f.get("dob"), gender: f.get("gender"), appLanguage: f.get("app"),
            audioLanguage: f.get("audio"), contactPhone: f.get("phone"),
          }, "PUT").catch(() => {}); // the account exists; details can be finished in Settings
          onDone();
        } catch (err) {
          setError((err as Error).message);
          setBusy(false);
        }
      }}
    >
      <Stepper at={1} />
      <div className="su-title">
        <h1>Create your account</h1>
        <p>One account per person. It takes about two minutes.</p>
      </div>
      <div className="su-socials">
        <GoogleButton enabled={google} />
        <button type="button" className="ghost wide social" onClick={(e) => { (e.currentTarget.nextElementSibling as HTMLElement | null)?.removeAttribute("hidden"); }}>
          Continue with Apple<span className="soon-tag">Soon</span>
        </button>
        <p className="pp-note su-span" role="status" hidden>Sign in with Apple is being switched on. Please use your email for now.</p>
      </div>
      <p className="su-or"><span>or with email</span></p>
      <div className="su-row">
        <label>First name<input name="first" autoComplete="given-name" required maxLength={40} /></label>
        <label>Last name<input name="last" autoComplete="family-name" required maxLength={40} /></label>
      </div>
      <label>Email<input name="email" type="email" autoComplete="email" required /></label>
      <div className="su-row">
        <label>Country<input value={country ? `${countryName(country)}  (detected)` : "Detected when you verify"} readOnly aria-readonly className="ro" /></label>
        <label>Mobile number<input name="phone" type="tel" autoComplete="tel" placeholder={`${dial} 803 555 0142`} required /></label>
      </div>
      <div className="su-row">
        <label>Date of birth<input name="dob" type="date" autoComplete="bday" required max={new Date(Date.now() - 13 * 365.25 * 864e5).toISOString().slice(0, 10)} /></label>
        <label>Gender (optional)
          <select name="gender" defaultValue="">
            <option value="">Prefer not to say</option>
            <option value="female">Female</option>
            <option value="male">Male</option>
            <option value="non-binary">Non-binary</option>
          </select>
        </label>
      </div>
      <div className="su-row">
        <label>App language
          <select name="app" defaultValue="en">{LANGUAGES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
        </label>
        <label>Audio language
          <select name="audio" defaultValue={country === "NG" ? "yo" : "en"}>{LANGUAGES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
        </label>
      </div>
      <label>Password
        <PasswordField autoComplete="new-password" required minLength={10} value={password} onChange={(e) => setPassword(e.target.value)} />
      </label>
      <div className={`su-strength s${s}`} aria-live="polite">
        {[1, 2, 3, 4].map((i) => <i key={i} className={i <= s ? "on" : ""} />)}
        <span>{password ? STRENGTH[s] : "At least 10 characters"}</span>
      </div>
      <label className="su-check">
        <input type="checkbox" checked={agreed} onChange={(e) => { setAgreed(e.target.checked); if (e.target.checked) setTermsError(false); }} aria-invalid={termsError} aria-describedby={termsError ? "terms-note" : undefined} />
        <span>I agree to the <a href="/terms" target="_blank">Terms</a> and <a href="/privacy" target="_blank">Privacy Policy</a>. E-Cinema never sells my data and I can download or delete it any time.</span>
      </label>
      {termsError && <p id="terms-note" className="pp-note pp-err" role="alert">One last step: tick the box to agree to our Terms and Privacy Policy, then press Continue.</p>}
      {error && <p className="pp-note pp-err" role="alert">{error}</p>}
      <button className="su-cta" disabled={busy}>{busy ? "Creating your account…" : "Continue"}</button>
      <p className="su-foot">Already have an account? <a href="/signin">Sign in</a></p>
    </form>
  );
}

function VerifyStep({ phone, identityStatus, onDone }: { phone?: string; identityStatus?: string; onDone: () => void }) {
  const [sentTo, setSentTo] = useState("");
  const [code, setCode] = useState("");
  const [verified, setVerified] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const send = async () => {
    setBusy(true); setNote("");
    try { setSentTo((await call("/api/auth/phone", { phone })).sentTo); }
    catch (e) { const m = (e as Error).message; setNote(/unavailable|switched on|not available/i.test(m) ? "Text codes are being switched on. You can verify your phone later from Settings." : m); }
    setBusy(false);
  };
  return (
    <div className="su-form">
      <Stepper at={2} />
      <div className="su-title">
        <h1>Confirm it&apos;s really you</h1>
        <p>We check every account once so seats, chats and payments belong to real people. Your documents are encrypted and deleted after review.</p>
      </div>
      <section className={`su-card${verified ? " done" : ""}`}>
        <span className="su-ico" aria-hidden>📱</span>
        <div>
          <strong>Phone number</strong>
          <small>{verified ? `Verified · ${sentTo}` : sentTo ? `Code sent to ${sentTo}` : phone ? `We text a 6-digit code to ${phone}` : "Add your mobile number in Settings"}</small>
          {sentTo && !verified && (
            <form className="su-inline" onSubmit={async (e) => { e.preventDefault(); setBusy(true); try { await call("/api/auth/phone/confirm", { code }); setVerified(true); } catch (er) { setNote((er as Error).message); } setBusy(false); }}>
              <input inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} placeholder="6-digit code" value={code} onChange={(e) => setCode(e.target.value)} required />
              <button className="su-sm" disabled={busy}>Confirm</button>
            </form>
          )}
          {note && <small className="su-note">{note}</small>}
        </div>
        {verified ? <span className="su-tag">DONE</span> : !sentTo && phone ? <button className="su-sm" onClick={send} disabled={busy}>Send code</button> : null}
      </section>
      <section className="su-card">
        <span className="su-ico" aria-hidden>🙂</span>
        <div>
          <strong>Face check</strong>
          <small>A 5-second selfie video. No photo is stored, only a match score.</small>
        </div>
        <FaceCheck initialStatus={identityStatus} />
      </section>
      <section className="su-card">
        <span className="su-ico" aria-hidden>🪪</span>
        <div>
          <strong>Government ID</strong>
          <small>Needed only before your first 18+ title or a payout. It is part of the face check above.</small>
        </div>
        <span className="su-later">Later</span>
      </section>
      <section className="su-card">
        <span className="su-ico" aria-hidden>🔑</span>
        <div>
          <strong>Passkey for this device</strong>
          <small>Sign in with your fingerprint or face instead of a password.</small>
        </div>
        <PasskeyButton />
      </section>
      <p className="su-info">🔒 Each face and phone number can hold one E-Cinema account. If we find a duplicate we ask you to sign in to the original instead.</p>
      <button className="su-cta" onClick={onDone}>Continue</button>
    </div>
  );
}

function PlanStep({ country, current, onFree, onPaid }: { country?: string; current?: PlanId; onFree: () => void; onPaid: () => void }) {
  const currency = currencyFor(country);
  const [plan, setPlan] = useState<PlanId>(current && current !== "free" ? current : "pro");
  const [promo, setPromo] = useState("");
  const [promoNote, setPromoNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const price = priceOf(plan, currency);
  const label = (id: PlanId) => {
    const p = PLANS.find((x) => x.id === id)!;
    const v = money(priceOf(id, currency), currency);
    return p.per === "seat" ? `from ${v}` : v;
  };
  return (
    <div className="su-form su-narrow">
      <Stepper at={3} />
      <div className="su-title">
        <h1>Pick a plan</h1>
        <p>Prices are in your local currency, detected from your country. You can switch plans any time.</p>
      </div>
      <div className="su-plans" role="radiogroup" aria-label="Plans">
        {PLANS.map((p) => (
          <button type="button" role="radio" aria-checked={plan === p.id} key={p.id} className={`su-plan${plan === p.id ? " on" : ""}`} onClick={() => setPlan(p.id)}>
            <i className="su-radio" />
            <span className="su-plan-copy">
              <strong>{p.name} <em className={`su-badge ${p.id}`}>{p.badge}</em></strong>
              <small>{p.blurb}</small>
            </span>
            <span className="su-price">{label(p.id)}{p.per && <small> /{p.per}</small>}</span>
          </button>
        ))}
      </div>
      <label className="su-promo">Promo or gift code
        <span>
          <input value={promo} onChange={(e) => { setPromo(e.target.value.toUpperCase()); setPromoNote(""); }} placeholder="E.g. UNILAG2026" maxLength={24} />
          <button type="button" className="su-sm ghost" onClick={() => setPromoNote(promo ? "That code is not valid. Check the spelling or try another." : "Enter a code first.")}>Apply</button>
        </span>
      </label>
      {promoNote && <p className="pp-note pp-err" role="alert">{promoNote}</p>}
      {error && <p className="pp-note pp-err" role="alert">{error}</p>}
      <button
        className="su-cta"
        disabled={busy}
        onClick={async () => {
          setBusy(true); setError("");
          try { await call("/api/me/plan", { plan }, "PUT"); plan === "free" ? onFree() : onPaid(); }
          catch (e) { setError((e as Error).message); setBusy(false); }
        }}
      >
        {plan === "free" ? "Continue with Free" : `Continue with ${PLANS.find((p) => p.id === plan)!.name} · ${money(price, currency)}/${PLANS.find((p) => p.id === plan)!.per}`}
      </button>
    </div>
  );
}

function PayStep({ country, plan, ready }: { country?: string; plan: PlanId; ready: Ready }) {
  const currency = currencyFor(country);
  const methods = useMemo(() => payMethods(country, ready), [country, ready]);
  const [method, setMethod] = useState(methods.find((m) => m.ready)?.id ?? methods[0].id);
  const p = PLANS.find((x) => x.id === plan)!;
  const price = priceOf(plan, currency);
  const vat = currency === "NGN" ? Math.round(price * vatRate(country)) : Math.round(price * vatRate(country) * 100) / 100;
  const renew = new Date(Date.now() + 30 * 864e5).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  const chosen = methods.find((m) => m.id === method)!;
  return (
    <div className="su-pay">
      <div className="su-form">
        <Stepper at={4} />
        <div className="su-title"><h1>How do you want to pay?</h1></div>
        <p className="su-info">🌐 Showing methods for {countryName(country) || "your country"}. Travelling? Prices stay in your home currency until you change country in Settings.</p>
        <div className="su-plans" role="radiogroup" aria-label="Payment method">
          {methods.map((m) => (
            <button type="button" role="radio" aria-checked={method === m.id} key={m.id} className={`su-plan${method === m.id ? " on" : ""}`} onClick={() => setMethod(m.id)}>
              <i className="su-radio" />
              <span className="su-plan-copy"><strong>{m.name}</strong><small>{m.sub}</small></span>
              {!m.ready && <span className="soon-tag">Soon</span>}
            </button>
          ))}
        </div>
      </div>
      <aside className="su-summary">
        <h2>Your plan</h2>
        <p className="su-line"><span>{p.name} <em className={`su-badge ${p.id}`}>{p.badge}</em></span><span>{money(price, currency)}/{p.per}</span></p>
        <p className="su-muted">Renews {renew}. Cancel any time in Settings.</p>
        <hr />
        {vat > 0 && <p className="su-line"><span>VAT ({(vatRate(country) * 100).toLocaleString("en")}%)</span><span>{money(vat, currency)}</span></p>}
        <p className="su-line su-due"><span>Due today</span><b>{money(price + vat, currency)}</b></p>
        <button className="su-cta" disabled={!chosen.ready}>{chosen.ready ? `Start ${p.name}` : `${chosen.name} is being switched on`}</button>
        {!chosen.ready && <p className="su-muted">You can keep using E-Cinema on Free until then. <a href="/home">Go to my home</a></p>}
        <p className="su-muted">Secured by the payment provider. We never store full card numbers.</p>
      </aside>
    </div>
  );
}
