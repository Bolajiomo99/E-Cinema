"use client";

import { useEffect, useRef, useState } from "react";

type SdkBuilder = {
  init(token: string, refresh: () => Promise<string>): SdkBuilder;
  withConf(conf: Record<string, unknown>): SdkBuilder;
  withOptions(opts: Record<string, unknown>): SdkBuilder;
  on(event: string, cb: (payload: unknown) => void): SdkBuilder;
  build(): { launch(selector: string): void };
};
declare global {
  interface Window { snsWebSdk?: SdkBuilder }
}

const SDK_URL = "https://static.sumsub.com/idensic/static/sns-websdk-builder.js";

class Locked extends Error {}

// With an unlock token (a locked account, signed out) the check runs through /unlock instead.
async function call(path: "token" | "refresh", unlockToken?: string) {
  const url = unlockToken ? `/api/auth/unlock/${path === "token" ? "identity" : "finish"}` : `/api/auth/identity/${path}`;
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(unlockToken ? { unlockToken } : {}) });
  const data = await res.json().catch(() => ({}));
  if (res.status === 423) throw new Locked(data.error ?? "This account is locked");
  if (!res.ok) throw new Error(data.error ?? "Could not reach the identity check");
  if (unlockToken && path === "refresh") return { check: { status: data.status }, unlocked: data.unlocked };
  return data;
}

function loadSdk(): Promise<SdkBuilder> {
  if (window.snsWebSdk) return Promise.resolve(window.snsWebSdk);
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = SDK_URL;
    s.async = true;
    s.onload = () => (window.snsWebSdk ? resolve(window.snsWebSdk) : reject(new Error("Check did not load")));
    s.onerror = () => reject(new Error("Check did not load, please try again"));
    document.head.appendChild(s);
  });
}

const LABEL: Record<string, string> = {
  approved: "Verified",
  pending: "Under review. This usually takes a few minutes.",
  retry: "Please try again with better light and your whole face in view.",
  rejected: "We could not verify this account. If you already have one, sign in to it instead.",
  locked: "Five face checks failed, so we locked this account and signed every device out. We emailed you a code to unlock it.",
};

// Liveness selfie plus ID document through Sumsub. Images go straight to Sumsub, never to our servers.
export default function FaceCheck({ initialStatus, onVerified, unlockToken }: { initialStatus?: string; onVerified?: () => void; unlockToken?: string }) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState(initialStatus ?? "");
  const [error, setError] = useState("");
  const host = useRef<HTMLDivElement>(null);

  const refresh = async () => {
    try {
      const r = await call("refresh", unlockToken);
      setStatus(r.check.status);
      if (r.check.status === "approved") onVerified?.();
    } catch (e) {
      // Five failed checks lock the account and sign this device out (email 33).
      if (e instanceof Locked) {
        setOpen(false);
        setStatus("locked");
      }
      // No applicant yet: nothing to show.
    }
  };

  useEffect(() => {
    if (!open) return;
    let alive = true;
    (async () => {
      try {
        const [sdk, first] = await Promise.all([loadSdk(), call("token", unlockToken)]);
        if (!alive) return;
        sdk
          .init(first.token, async () => (await call("token", unlockToken)).token)
          .withConf({ lang: navigator.language.slice(0, 2) || "en", theme: "dark" })
          .withOptions({ addViewportTag: false, adaptIframeHeight: true })
          .on("idCheck.onApplicantSubmitted", () => refresh())
          .on("idCheck.onApplicantStatusChanged", () => refresh())
          .build()
          .launch("#face-check-host");
      } catch (e) {
        setError((e as Error).message);
        setOpen(false);
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (status === "approved") return <span className="tag ok">Verified</span>;
  return (
    <div className="face-check">
      {status && <p className="muted">{LABEL[status] ?? status}</p>}
      {status === "locked" && <a className="cta" href="/unlock-account">Unlock my account</a>}
      {!open && status !== "rejected" && status !== "locked" && (
        <div className="inline">
          <button className="cta" onClick={() => { setError(""); setOpen(true); }}>{status ? "Continue check" : "Start face check"}</button>
          {status === "pending" && <button className="ghost" onClick={refresh}>Refresh</button>}
        </div>
      )}
      {open && <div id="face-check-host" ref={host} className="face-host" />}
      {error && <p className="pp-note pp-err" role="alert">{error}</p>}
    </div>
  );
}
