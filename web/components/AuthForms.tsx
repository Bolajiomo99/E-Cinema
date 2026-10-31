"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import FaceCheck from "@/components/FaceCheck";
import { addPasskey, signInWithPasskey } from "@/lib/passkey-client";

async function post(path: string, body: unknown, method = "POST") {
  const res = await fetch(`/api/auth/${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? "Something went wrong, please try again");
  return data;
}

function strength(pw: string) {
  let score = 0;
  if (pw.length >= 10) score++;
  if (pw.length >= 14) score++;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) score++;
  if (/\d/.test(pw) || /[^A-Za-z0-9]/.test(pw)) score++;
  return pw.length < 10 ? "Too short" : ["Weak", "Weak", "Fair", "Good", "Strong"][score];
}

function Steps({ at }: { at: 1 | 2 }) {
  return (
    <ol className="steps">
      {["Account", "Verify"].map((s, i) => (
        <li key={s} className={i + 1 === at ? "on" : i + 1 < at ? "done" : ""}>{i + 1}. {s}</li>
      ))}
    </ol>
  );
}

export function JoinFlow({ startAt = 1, identityStatus }: { startAt?: 1 | 2; identityStatus?: string }) {
  const router = useRouter();
  const [step, setStep] = useState<1 | 2>(startAt);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [password, setPassword] = useState("");
  const [phone, setPhone] = useState("");
  const [sentTo, setSentTo] = useState("");
  const [code, setCode] = useState("");
  const [verified, setVerified] = useState(false);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (step === 1) {
    return (
      <form
        className="auth-card"
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          run(async () => {
            await post("signup", { name: f.get("name"), email: f.get("email"), password, terms: f.get("terms") === "on" });
            setStep(2);
          });
        }}
      >
        <Steps at={1} />
        <h2>Create your account</h2>
        <p className="muted">One account per person. It takes about two minutes.</p>
        <button type="button" className="ghost wide social" onClick={() => window.location.assign("/api/auth/google/start")}>Continue with Google</button>
        <p className="or">or with email</p>
        <label>Full name<input name="name" autoComplete="name" required maxLength={80} /></label>
        <label>Email<input name="email" type="email" autoComplete="email" required /></label>
        <label>
          Password
          <input type="password" autoComplete="new-password" required minLength={10} value={password} onChange={(e) => setPassword(e.target.value)} />
          {password && <span className="hint">{strength(password)}</span>}
        </label>
        <label className="check">
          <input type="checkbox" name="terms" required />
          <span>I agree to the Terms and Privacy Policy. E-Cinema never sells my data and I can download or delete it any time.</span>
        </label>
        <button className="cta" disabled={busy}>{busy ? "Creating…" : "Continue"}</button>
        {error && <p className="pp-note pp-err" role="alert">{error}</p>}
        <p className="muted">Already have an account? <a href="/signin">Sign in</a></p>
      </form>
    );
  }

  return (
    <div className="auth-card">
      <Steps at={2} />
      <h2>Confirm it&apos;s really you</h2>
      <p className="muted">We check every account once so seats, chats and payments belong to real people.</p>
      <section className="verify-row">
        <div>
          <strong>Phone number</strong>
          <p className="muted">{verified ? `Verified · ${sentTo}` : sentTo ? `Code sent to ${sentTo}` : "We text you a 6-digit code."}</p>
        </div>
        {!verified && !sentTo && (
          <form className="inline" onSubmit={(e) => { e.preventDefault(); run(async () => setSentTo((await post("phone", { phone })).sentTo)); }}>
            <input type="tel" autoComplete="tel" placeholder="+234 803 555 0142" value={phone} onChange={(e) => setPhone(e.target.value)} required />
            <button className="cta" disabled={busy}>Send code</button>
          </form>
        )}
        {!verified && sentTo && (
          <form className="inline" onSubmit={(e) => { e.preventDefault(); run(async () => { await post("phone/confirm", { code }); setVerified(true); }); }}>
            <input inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} placeholder="6-digit code" value={code} onChange={(e) => setCode(e.target.value)} required />
            <button className="cta" disabled={busy}>Confirm</button>
          </form>
        )}
      </section>
      <section className="verify-row">
        <div>
          <strong>Face check</strong>
          <p className="muted">A short selfie video and a photo of your ID, checked by our verification partner. Your documents are encrypted and never stored by E-Cinema.</p>
        </div>
        <FaceCheck initialStatus={identityStatus} />
      </section>
      <section className="verify-row">
        <div>
          <strong>Passkey for this device</strong>
          <p className="muted">Sign in with your fingerprint or face instead of a password.</p>
        </div>
        <PasskeyButton />
      </section>
      {error && <p className="pp-note pp-err" role="alert">{error}</p>}
      <p className="muted small">Each face and phone number can hold one E-Cinema account. If we find a duplicate we ask you to sign in to the original instead.</p>
      <button className="cta" onClick={() => router.push("/checkout")}>{verified ? "Continue" : "Skip for now"}</button>
    </div>
  );
}

const SIGNIN_ERRORS: Record<string, string> = {
  "google-off": "Google sign-in is not switched on yet. Use your email or a passkey.",
  "google-failed": "Google sign-in did not finish. Please try again.",
  "google-email": "Your Google account needs a verified email address.",
};

export function SignInForm({ initialError }: { initialError?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(initialError ? SIGNIN_ERRORS[initialError] ?? "" : "");
  return (
    <form
      className="auth-card"
      onSubmit={async (e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        setBusy(true);
        setError("");
        try {
          const r = await post("signin", { email: f.get("email"), password: f.get("password") });
          router.push(r.session?.signedOut ? "/account/devices?signedOut=1" : "/checkout");
          router.refresh();
        } catch (err) {
          setError((err as Error).message);
          setBusy(false);
        }
      }}
    >
      <h2>Welcome back</h2>
      <p className="muted">Sign in to take your seat.</p>
      <button type="button" className="ghost wide social" onClick={() => window.location.assign("/api/auth/google/start")}>Continue with Google</button>
      <p className="or">or with email</p>
      <label>Email<input name="email" type="email" autoComplete="email" required /></label>
      <label>Password<input name="password" type="password" autoComplete="current-password" required /></label>
      <button className="cta" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
      <button
        type="button"
        className="ghost wide"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError("");
          try {
            const r = await signInWithPasskey();
            router.push(r.session?.signedOut ? "/account/devices?signedOut=1" : "/checkout");
            router.refresh();
          } catch (err) {
            setError((err as Error).message);
            setBusy(false);
          }
        }}
      >
        Sign in with a passkey
      </button>
      {error && <p className="pp-note pp-err" role="alert">{error}</p>}
      <p className="muted small">You can be signed in on 2 devices. Signing in here signs out the oldest one.</p>
      <p className="muted">New to E-Cinema? <a href="/join">Join free</a></p>
    </form>
  );
}

type Device = { id: string; device: string; lastSeenAt: string; current: boolean };

export function DevicesList({ devices: initial, max }: { devices: Device[]; max: number }) {
  const router = useRouter();
  const [devices, setDevices] = useState(initial);
  const [error, setError] = useState("");
  return (
    <div className="auth-card wide">
      <h2>Signed-in devices · {devices.length} of {max}</h2>
      <p className="muted">Each account can be signed in on {max} devices. Another sign-in signs out the oldest.</p>
      <ul className="devices">
        {devices.map((d) => (
          <li key={d.id}>
            <div>
              <strong>{d.device}</strong>
              <span className="muted">{d.current ? "This device · active now" : `Last active ${new Date(d.lastSeenAt).toLocaleString()}`}</span>
            </div>
            {!d.current && (
              <button
                className="ghost"
                onClick={async () => {
                  try {
                    await post(`devices/${d.id}`, {}, "DELETE");
                    setDevices((list) => list.filter((x) => x.id !== d.id));
                  } catch (e) {
                    setError((e as Error).message);
                  }
                }}
              >
                Sign out
              </button>
            )}
          </li>
        ))}
      </ul>
      {error && <p className="pp-note pp-err" role="alert">{error}</p>}
      <button
        className="ghost"
        onClick={async () => {
          await post("signout", {});
          router.push("/signin");
          router.refresh();
        }}
      >
        Sign out of this device
      </button>
    </div>
  );
}

export function PasskeyButton({ onAdded }: { onAdded?: (p: Passkey) => void }) {
  const [state, setState] = useState<"idle" | "busy" | "done">("idle");
  const [error, setError] = useState("");
  if (state === "done") return <span className="tag ok">Passkey added</span>;
  return (
    <div className="face-check">
      <button
        className="cta"
        disabled={state === "busy"}
        onClick={async () => {
          setState("busy");
          setError("");
          try {
            const p = await addPasskey();
            setState("done");
            onAdded?.(p);
          } catch (e) {
            setError((e as Error).message);
            setState("idle");
          }
        }}
      >
        Add a passkey
      </button>
      {error && <p className="pp-note pp-err" role="alert">{error}</p>}
    </div>
  );
}

type Passkey = { id: string; name: string; createdAt: string; lastUsedAt?: string };

export function PasskeysList({ passkeys: initial }: { passkeys: Passkey[] }) {
  const [passkeys, setPasskeys] = useState(initial);
  const [error, setError] = useState("");
  return (
    <div className="auth-card wide">
      <h2>Passkeys</h2>
      <p className="muted">Sign in with your fingerprint or face. Each passkey stays on the device that made it.</p>
      <ul className="devices">
        {passkeys.map((p) => (
          <li key={p.id}>
            <div>
              <strong>{p.name}</strong>
              <span className="muted">{p.lastUsedAt ? `Last used ${new Date(p.lastUsedAt).toLocaleString()}` : `Added ${new Date(p.createdAt).toLocaleDateString()}`}</span>
            </div>
            <button
              className="ghost"
              onClick={async () => {
                try {
                  await post(`passkeys/${p.id}`, {}, "DELETE");
                  setPasskeys((list) => list.filter((x) => x.id !== p.id));
                } catch (e) {
                  setError((e as Error).message);
                }
              }}
            >
              Remove
            </button>
          </li>
        ))}
      </ul>
      {error && <p className="pp-note pp-err" role="alert">{error}</p>}
      <PasskeyButton key={passkeys.length} onAdded={(p) => setPasskeys((list) => [...list, p])} />
    </div>
  );
}
