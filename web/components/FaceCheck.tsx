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

async function call(path: string) {
  const res = await fetch(`/api/auth/identity/${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? "Could not reach the identity check");
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
};

// Liveness selfie plus ID document through Sumsub. Images go straight to Sumsub, never to our servers.
export default function FaceCheck({ initialStatus, onVerified }: { initialStatus?: string; onVerified?: () => void }) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState(initialStatus ?? "");
  const [error, setError] = useState("");
  const host = useRef<HTMLDivElement>(null);

  const refresh = async () => {
    try {
      const r = await call("refresh");
      setStatus(r.check.status);
      if (r.check.status === "approved") onVerified?.();
    } catch {
      // No applicant yet: nothing to show.
    }
  };

  useEffect(() => {
    if (!open) return;
    let alive = true;
    (async () => {
      try {
        const [sdk, first] = await Promise.all([loadSdk(), call("token")]);
        if (!alive) return;
        sdk
          .init(first.token, async () => (await call("token")).token)
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
      {!open && status !== "rejected" && (
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
