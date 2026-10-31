"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { addPasskey, signInWithPasskey } from "@/lib/passkey-client";

// Sign in (Figma 16:296) and password recovery (Figma 105:1186, 29:556, 105:1239,
// 105:1314, 105:1357, 105:1402, 105:1447): one card on the red glow.

type ApiError = Error & { status?: number; body?: Record<string, unknown> };

async function post(path: string, body: unknown) {
  const res = await fetch(`/api/auth/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = new Error(data.error ?? "Something went wrong, please try again") as ApiError;
    e.status = res.status;
    e.body = data;
    throw e;
  }
  return data;
}

function safeNext(next?: string) {
  return next && /^\/(?![/\\])[\w\-/.?=&#%]*$/.test(next) ? next : "/home";
}

const ICONS = {
  key: <><circle cx="8" cy="15" r="4" /><path d="m11 12 8-8m-3 3 2 2m-4 0 2 2" /></>,
  mail: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3 7 9 6 9-6" /></>,
  face: <><path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2" /><path d="M9 10v1M15 10v1M9 15c1.5 1.3 4.5 1.3 6 0" /></>,
  check: <path d="m5 12 5 5 9-10" />,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  lock: <><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></>,
  shield: <><path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z" /><path d="m9 12 2 2 4-4" /></>,
};

function Icon({ name, tone = "red", small }: { name: keyof typeof ICONS; tone?: "red" | "green"; small?: boolean }) {
  return (
    <span className={`ca-ico ${tone}${small ? " sm" : ""}`} aria-hidden>
      <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        {ICONS[name]}
      </svg>
    </span>
  );
}

function Bars({ at, of = 4, tone = "red" }: { at: number; of?: number; tone?: "red" | "teal" }) {
  return (
    <div className={`ca-bars ${tone}`} aria-label={tone === "red" ? `Step ${at} of ${of}` : undefined}>
      {Array.from({ length: of }, (_, i) => <i key={i} className={i < at ? "on" : ""} />)}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="ca-field"><span>{label}</span>{children}</label>;
}

function Password({ shown, onToggle, ...props }: React.InputHTMLAttributes<HTMLInputElement> & { shown: boolean; onToggle: () => void }) {
  return (
    <span className="ca-pw">
      <input {...props} type={shown ? "text" : "password"} />
      <button type="button" onClick={onToggle} aria-label={shown ? "Hide password" : "Show password"} aria-pressed={shown}>{shown ? "Hide" : "Show"}</button>
    </span>
  );
}

// Six single-digit boxes that behave like one field (paste, backspace, arrow keys).
function CodeBoxes({ value, onChange, onDone }: { value: string; onChange: (v: string) => void; onDone?: (v: string) => void }) {
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  const set = (v: string) => {
    const clean = v.replace(/\D/g, "").slice(0, 6);
    onChange(clean);
    refs.current[Math.min(clean.length, 5)]?.focus();
    if (clean.length === 6) onDone?.(clean);
  };
  return (
    <div className="ca-code" role="group" aria-label="6-digit code">
      {Array.from({ length: 6 }, (_, i) => (
        <input
          key={i}
          ref={(el) => { refs.current[i] = el; }}
          inputMode="numeric"
          autoComplete={i === 0 ? "one-time-code" : "off"}
          aria-label={`Digit ${i + 1}`}
          value={value[i] ?? ""}
          className={i === value.length ? "next" : ""}
          onChange={(e) => {
            const typed = e.target.value.replace(/\D/g, "");
            if (typed.length > 1) return set(value.slice(0, i) + typed);
            set((value.slice(0, i) + typed + value.slice(i + 1)).slice(0, typed ? 6 : i));
          }}
          onKeyDown={(e) => {
            if (e.key === "Backspace" && !value[i] && i > 0) { e.preventDefault(); set(value.slice(0, i - 1)); }
            if (e.key === "ArrowLeft" && i > 0) refs.current[i - 1]?.focus();
            if (e.key === "ArrowRight" && i < 5) refs.current[i + 1]?.focus();
          }}
          onPaste={(e) => { e.preventDefault(); set(e.clipboardData.getData("text")); }}
        />
      ))}
    </div>
  );
}

function useCountdown(seconds: number) {
  const [left, setLeft] = useState(seconds);
  useEffect(() => {
    if (left <= 0) return;
    const t = setTimeout(() => setLeft((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [left]);
  return [left, setLeft] as const;
}

const clock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

function Err({ text }: { text: string }) {
  return text ? <p className="ca-err" role="alert">{text[0].toUpperCase() + text.slice(1)}</p> : null;
}

const SIGNIN_ERRORS: Record<string, string> = {
  "google-off": "Google sign-in is not switched on yet. Use your email or a passkey.",
  "google-failed": "Google sign-in did not finish. Please try again.",
  "google-email": "Your Google account needs a verified email address.",
};

export function SignInCard({ next, initialError }: { next?: string; initialError?: string }) {
  const dest = safeNext(next);
  const router = useRouter();
  const [id, setId] = useState("");
  const [shown, setShown] = useState(false);
  const [keep, setKeep] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(initialError ? SIGNIN_ERRORS[initialError] ?? "" : "");
  const [sent, setSent] = useState<{ sentTo: string; channel: "email" | "sms" } | null>(null);
  const [code, setCode] = useState("");
  const [left, setLeft] = useCountdown(0);

  const done = (r: { session?: { signedOut?: number } }) => {
    router.push(r.session?.signedOut ? "/account/devices?signedOut=1" : dest);
    router.refresh();
  };
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };
  const sendCode = () => run(async () => {
    if (!id.trim()) throw new Error("Enter your email or mobile number first, then we can send you a code.");
    const r = await post("codes", { identifier: id, purpose: "login" });
    setSent(r);
    setCode("");
    setLeft(60);
    setBusy(false);
  });
  const verify = (c = code) => run(async () => {
    if (c.length !== 6) throw new Error("Enter all 6 digits of the code.");
    done(await post("codes/login", { identifier: id, code: c, keep }));
  });

  if (sent) {
    return (
      <form className="ca-card center" onSubmit={(e) => { e.preventDefault(); verify(); }}>
        <Icon name="mail" small />
        <h1>{sent.channel === "sms" ? "Check your phone" : "Check your email"}</h1>
        <p className="ca-sub">We sent a 6-digit code to {sent.sentTo}{sent.channel === "sms" ? " by SMS" : ""}. It works once and ends in 10 minutes.</p>
        <CodeBoxes value={code} onChange={setCode} onDone={verify} />
        <Err text={error} />
        <button className="ca-btn red" disabled={busy}>{busy ? "Checking…" : "Verify code"}</button>
        <div className="ca-row">
          {left > 0 ? <span className="ca-dim">Resend in {clock(left)}</span> : <button type="button" className="ca-link" onClick={sendCode} disabled={busy}>Resend code</button>}
          <button type="button" className="ca-link" onClick={() => { setSent(null); setError(""); }}>Use password instead</button>
        </div>
      </form>
    );
  }

  return (
    <form className="ca-card" onSubmit={(e) => { e.preventDefault(); const pw = new FormData(e.currentTarget).get("password"); run(async () => done(await post("signin", { email: id, password: pw, keep }))); }}>
      <h1>Welcome back</h1>
      <p className="ca-sub">Sign in to take your seat.</p>
      <Field label="Email or mobile number">
        <input name="email" autoComplete="username" value={id} onChange={(e) => setId(e.target.value)} required />
      </Field>
      <Field label="Password">
        <Password name="password" autoComplete="current-password" shown={shown} onToggle={() => setShown((v) => !v)} required />
      </Field>
      <div className="ca-row">
        <label className="ca-check">
          <input type="checkbox" checked={keep} onChange={(e) => setKeep(e.target.checked)} />
          <span>Keep me signed in on this device</span>
        </label>
        <a className="ca-link strong" href={`/forgot${id ? `?id=${encodeURIComponent(id)}` : ""}`}>Forgot password?</a>
      </div>
      <Err text={error} />
      <button className="ca-btn red" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
      <button type="button" className="ca-btn line" disabled={busy} onClick={() => run(async () => done(await signInWithPasskey()))}>Use a passkey</button>
      <button type="button" className="ca-btn line" disabled={busy} onClick={sendCode}>Get a one-time code</button>
      <p className="ca-note"><Icon name="lock" small />You can be signed in on 2 devices. Signing in here signs out the oldest one.</p>
      <p className="ca-foot">New to E‑Cinema? <a href="/join">Join free</a></p>
    </form>
  );
}

type Stage = "find" | "code" | "face" | "password" | "done" | "expired";

export function ForgotFlow({ initialId = "", initialCode = "" }: { initialId?: string; initialCode?: string }) {
  const router = useRouter();
  const [stage, setStage] = useState<Stage>(initialId && initialCode ? "code" : "find");
  const [id, setId] = useState(initialId);
  const [sent, setSent] = useState<{ sentTo: string; channel: "email" | "sms" }>({ sentTo: initialId, channel: "email" });
  const [code, setCode] = useState(initialCode);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [left, setLeft] = useCountdown(0);
  const [pause, setPause] = useCountdown(0);
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [shown, setShown] = useState(false);
  const [leaked, setLeaked] = useState<boolean | null>(null);
  const [others, setOthers] = useState(true);
  const [result, setResult] = useState<{ email: string; signedOut: number; emailed: boolean } | null>(null);
  const [passkey, setPasskey] = useState("");

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      const err = e as ApiError;
      if (err.status === 410) setStage("expired");
      else if (err.status === 429 && typeof err.body?.pausedFor === "number") { setPause(err.body.pausedFor); setStage("expired"); }
      else setError(err.message);
    }
    setBusy(false);
  };
  const send = () => run(async () => {
    if (!id.trim()) throw new Error("Enter the phone number or email on your account.");
    setSent(await post("codes", { identifier: id, purpose: "reset" }));
    setCode("");
    setLeft(60);
    setStage("code");
  });
  const verify = (c = code) => run(async () => {
    if (c.length !== 6) throw new Error("Enter all 6 digits of the code.");
    await post("codes/reset", { identifier: id, code: c });
    setStage("face");
  });

  // Opened from the email link: check the code straight away.
  const auto = useRef(false);
  useEffect(() => {
    if (!auto.current && initialId && initialCode.length === 6) {
      auto.current = true;
      verify(initialCode);
    }
  }); // eslint-disable-line react-hooks/exhaustive-deps

  // Live leaked-password check, debounced; only a 5-character hash prefix leaves our server.
  useEffect(() => {
    if (pw.length < 12) { setLeaked(null); return; }
    const t = setTimeout(async () => {
      try { setLeaked((await post("password/check", { password: pw })).leaked); } catch { setLeaked(null); }
    }, 500);
    return () => clearTimeout(t);
  }, [pw]);

  const strength = Math.min(4, [pw.length >= 12, /[A-Z]/.test(pw) && /[a-z]/.test(pw), /\d/.test(pw), /[^A-Za-z0-9]/.test(pw) || pw.length >= 16].filter(Boolean).length);

  if (stage === "find") {
    return (
      <form className="ca-card" onSubmit={(e) => { e.preventDefault(); send(); }}>
        <Bars at={1} />
        <Icon name="key" />
        <h1>Forgot your password?</h1>
        <p className="ca-sub">Enter the phone number or email on your account. We will send a 6-digit code.</p>
        <Field label="Phone or email"><input autoComplete="username" value={id} onChange={(e) => setId(e.target.value)} autoFocus required /></Field>
        <Err text={error} />
        <button className="ca-btn red" disabled={busy}>{busy ? "Sending…" : "Send code"}</button>
        <div className="ca-row">
          <button type="button" className="ca-link red" disabled={busy} onClick={() => run(async () => { await signInWithPasskey(); router.push("/home"); router.refresh(); })}>Use a passkey instead</button>
          <a className="ca-link" href="/signin">Back to sign in</a>
        </div>
      </form>
    );
  }

  if (stage === "code") {
    const sms = sent.channel === "sms";
    return (
      <form className="ca-card center" onSubmit={(e) => { e.preventDefault(); verify(); }}>
        <Icon name="mail" small />
        <h1>{sms ? "Check your phone" : "Check your email"}</h1>
        <p className="ca-sub">
          {sms
            ? `We sent a 6-digit code to ${sent.sentTo} by SMS.`
            : `We sent a reset link and code to ${sent.sentTo}. It works once and ends in 10 minutes.`}
        </p>
        <CodeBoxes value={code} onChange={setCode} onDone={verify} />
        <Err text={error} />
        <button className="ca-btn red" disabled={busy}>{busy ? "Checking…" : "Verify code"}</button>
        {!sms && <p className="ca-dim small">Nothing arrived? Check spam{left > 0 ? `, or resend in ${clock(left)}.` : "."}</p>}
        <div className="ca-row">
          {left > 0 ? <span className="ca-dim">Resend in {clock(left)}</span> : <button type="button" className="ca-link" onClick={send} disabled={busy}>Resend code</button>}
          <button type="button" className="ca-link strong" onClick={() => { setStage("find"); setError(""); }}>{sms ? "Use email instead" : "Use phone instead"}</button>
        </div>
      </form>
    );
  }

  if (stage === "face") {
    return (
      <div className="ca-card">
        <Bars at={3} />
        <Icon name="face" />
        <h1>Quick face check <span className="soon-tag">Soon</span></h1>
        <p className="ca-sub">Face checks on password resets are being switched on. When they are, you look at your camera for 3 seconds so nobody else can take over your account, even with your code. For now your code protects this reset.</p>
        <div className="ca-oval" aria-hidden><i /></div>
        <button className="ca-btn red" onClick={() => setStage("password")}>Continue</button>
        <p className="ca-dim small">Your face will be checked against your sign-up scan and never stored as a photo.</p>
      </div>
    );
  }

  if (stage === "password") {
    const rules: [string, boolean | null][] = [
      ["At least 12 characters", pw.length >= 12],
      ["Not used on another site we know was leaked", leaked === null ? null : !leaked],
      ["Not one of your last 5 passwords", null],
    ];
    return (
      <form className="ca-card" onSubmit={(e) => {
        e.preventDefault();
        run(async () => {
          const r = await post("password/reset", { password: pw, confirm: pw2, signOutOthers: others });
          setResult({ email: r.account.email, signedOut: r.signedOutOthers, emailed: r.emailed });
          setStage("done");
        });
      }}>
        <Bars at={4} />
        <Icon name="key" />
        <h1>Set a new password</h1>
        <Field label="New password">
          <Password autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} shown={shown} onToggle={() => setShown((v) => !v)} minLength={12} required autoFocus />
        </Field>
        <Bars at={strength} tone="teal" />
        <ul className="ca-rules">
          {rules.map(([t, ok]) => <li key={t} className={ok === true ? "ok" : ok === false ? "bad" : ""}>{t}</li>)}
        </ul>
        <Field label="Type it again">
          <Password autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} shown={shown} onToggle={() => setShown((v) => !v)} required />
        </Field>
        <label className="ca-toggle">
          <span><strong>Sign out of all other devices</strong><small>Recommended if you think someone else had access</small></span>
          <input type="checkbox" role="switch" checked={others} onChange={(e) => setOthers(e.target.checked)} />
        </label>
        <Err text={error} />
        <button className="ca-btn red" disabled={busy}>{busy ? "Saving…" : "Save new password"}</button>
      </form>
    );
  }

  if (stage === "done" && result) {
    return (
      <div className="ca-card">
        <Icon name="check" tone="green" />
        <h1>Password changed</h1>
        <p className="ca-sub">
          You are signed in on this device{result.signedOut ? " and signed out everywhere else" : ""}.
          {result.emailed ? ` We sent a confirmation to ${result.email}.` : ""}
        </p>
        {result.emailed && (
          <div className="ca-box"><strong>Was this not you?</strong><small>Tap &ldquo;This wasn&rsquo;t me&rdquo; in the email and we lock the account straight away.</small></div>
        )}
        <Err text={error} />
        {passkey && <p className="ca-ok" role="status">{passkey}</p>}
        <button className="ca-btn red" onClick={() => { router.push("/home"); router.refresh(); }}>Continue to E-Cinema</button>
        <button className="ca-btn line" disabled={busy || Boolean(passkey)} onClick={() => run(async () => { await addPasskey(); setPasskey("Passkey added. Next time, sign in with your face or fingerprint."); })}>Add a passkey for next time</button>
      </div>
    );
  }

  // Expired code, or resets paused after 5 wrong tries.
  return (
    <div className="ca-card center">
      <Icon name="clock" small />
      <h1>{pause > 0 ? "Resets are paused" : "That code has expired"}</h1>
      <p className="ca-sub">Codes work for 10 minutes. After 5 wrong tries we pause resets for 30 minutes to keep your account safe.</p>
      {pause > 0 ? (
        <p className="ca-box center">You can try again in <strong>{clock(pause)}</strong></p>
      ) : (
        <button className="ca-btn red" disabled={busy} onClick={() => { setCode(""); id ? send() : setStage("find"); }}>Send a new code</button>
      )}
      <Err text={error} />
      <div className="ca-row"><a className="ca-link" href="/signin">Back to sign in</a><a className="ca-link" href="/concierge">Get help</a></div>
    </div>
  );
}

export function LockCard({ token }: { token: string }) {
  const [state, setState] = useState<"ask" | "done">("ask");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (state === "done") {
    return (
      <div className="ca-card">
        <Icon name="shield" tone="green" />
        <h1>Account locked</h1>
        <p className="ca-sub">Every device is signed out and the new password no longer works. Reset your password with a code to get back in.</p>
        <a className="ca-btn red" href="/forgot">Reset my password</a>
      </div>
    );
  }
  return (
    <div className="ca-card">
      <Icon name="lock" />
      <h1>This wasn&rsquo;t you?</h1>
      <p className="ca-sub">We will sign out every device and block the password that was just set. You then reset it yourself with a code sent to your email or phone.</p>
      <Err text={error} />
      <button className="ca-btn red" disabled={busy || !token} onClick={async () => {
        setBusy(true);
        setError("");
        try { await post("password/lock", { token }); setState("done"); } catch (e) { setError((e as ApiError).status === 400 ? "This link has already been used or has expired. If you still cannot get in, reset your password." : (e as Error).message); }
        setBusy(false);
      }}>{busy ? "Locking…" : "Yes, lock my account"}</button>
      <a className="ca-btn line" href="/">It was me</a>
    </div>
  );
}
