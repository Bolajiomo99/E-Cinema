"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { addPasskey } from "@/lib/passkey-client";


export function GoogleButton({ enabled }: { enabled: boolean }) {
  const [note, setNote] = useState(false);
  return (
    <>
      <button
        type="button"
        className="ghost wide social"
        onClick={() => (enabled ? window.location.assign("/api/auth/google/start") : setNote(true))}
        aria-describedby={note ? "google-note" : undefined}
      >
        Continue with Google{!enabled && <span className="soon-tag">Soon</span>}
      </button>
      {note && <p id="google-note" className="pp-note" role="status">Google sign-in is being switched on. Please use your email for now.</p>}
    </>
  );
}

export function PasswordField({ label = "Password", ...props }: React.InputHTMLAttributes<HTMLInputElement> & { label?: string }) {
  const [shown, setShown] = useState(false);
  return (
    <span className="pw">
      <input {...props} type={shown ? "text" : "password"} aria-label={label} />
      <button type="button" className="pw-eye" onClick={() => setShown((v) => !v)} aria-label={shown ? "Hide password" : "Show password"} aria-pressed={shown}>
        {shown ? "Hide" : "Show"}
      </button>
    </span>
  );
}

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
