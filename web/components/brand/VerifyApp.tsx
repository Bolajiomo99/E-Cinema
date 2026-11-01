"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import ProductArt from "@/components/store/ProductArt";
import type { Check } from "@/lib/brand-types";

// Built from the Figma frames "Web / Verify a product · Genuine" (114:1751) and "· Not genuine" (114:1818).
type Detector = { detect: (src: CanvasImageSource) => Promise<{ rawValue: string }[]> };
declare global {
  interface Window { BarcodeDetector?: new (o: { formats: string[] }) => Detector }
}

const artFor = (product: string) =>
  /hoodie/i.test(product) ? "premiere-hoodie" : /cap/i.test(product) ? "premiere-cap" : /tote|bag/i.test(product) ? "tote-bag" : /umbrella/i.test(product) ? "umbrella" : /bottle/i.test(product) ? "steel-bottle" : /vr/i.test(product) ? "vr-headset" : "logo-tshirt";

function when(iso?: string) {
  if (!iso) return "";
  const d = new Date(iso);
  const today = new Date();
  if (d.toDateString() === today.toDateString()) return "today";
  return `on ${d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: d.getFullYear() === today.getFullYear() ? undefined : "numeric" })}`;
}

function notGenuineText(c: Check) {
  const many = `This code was already scanned ${c.scans.toLocaleString()} times in ${c.places} ${c.places === 1 ? "place" : c.places < 4 ? "places" : "cities"}`;
  switch (c.reason) {
    case "copied":
      return `${many}, so the label has been copied onto other items.`;
    case "ended":
      return `This code was made by ${c.licensee?.name ?? "a former partner"}, whose E‑Cinema licence has ended. Items sold now are not official.`;
    default:
      return c.scans > 1 ? `${many}, and was never issued by E‑Cinema.` : "E‑Cinema never issued this code, so the label is not ours.";
  }
}

export default function VerifyApp({ initial }: { initial?: string }) {
  const [code, setCode] = useState(initial ?? "");
  const [res, setRes] = useState<Check | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [canScan, setCanScan] = useState(false);
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const ran = useRef(false);

  const check = useCallback(async (value: string) => {
    const v = value.trim();
    if (!v) return setErr("Type the code on the label");
    setBusy(true);
    setErr("");
    try {
      const r = await fetch("/api/brand/verify", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code: v }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "Try again");
      const c = j as Check;
      if (c.reason === "bad") {
        setRes(null);
        setErr("Codes look like EC-QR-7F3K-29XA. Check the label and try again.");
      } else {
        setRes(c);
        setCode(c.code);
        const u = new URL(location.href);
        u.searchParams.set("code", c.code);
        history.replaceState(null, "", u);
      }
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    setCanScan(typeof window.BarcodeDetector === "function" && Boolean(navigator.mediaDevices?.getUserMedia));
    if (initial && !ran.current) {
      ran.current = true;
      void check(initial);
    }
  }, [initial, check]);

  const stop = () => {
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    setScanning(false);
  };
  useEffect(() => stop, []);

  async function scan() {
    if (!window.BarcodeDetector) return;
    setErr("");
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
      stream.current = s;
      setScanning(true);
      await new Promise((r) => requestAnimationFrame(r));
      if (!video.current) return stop();
      video.current.srcObject = s;
      await video.current.play();
      const det = new window.BarcodeDetector({ formats: ["qr_code"] });
      const tick = async () => {
        if (!stream.current || !video.current) return;
        const found = await det.detect(video.current).catch(() => []);
        if (found[0]?.rawValue) {
          stop();
          setCode(found[0].rawValue);
          void check(found[0].rawValue);
          return;
        }
        setTimeout(tick, 250);
      };
      void tick();
    } catch {
      stop();
      setErr("The camera is not available. Type the code instead.");
    }
  }

  return (
    <>
      <section className="vf-top">
        <p className="vf-eyebrow">VERIFY A PRODUCT</p>
        <p className="vf-sub">Scan the QR label or type the code on any E-Cinema item</p>
        <form className="vf-in" onSubmit={(e) => { e.preventDefault(); void check(code); }}>
          <label className="vf-field">
            <span>Code on the label</span>
            <div className="vf-box">
              <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="EC-QR-7F3K-29XA" autoCapitalize="characters" autoComplete="off" spellCheck={false} maxLength={200} aria-describedby="vf-err" />
              {canScan && (
                <button type="button" className="vf-scan" onClick={scanning ? stop : scan} aria-label={scanning ? "Stop scanning" : "Scan the QR label"}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden><path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3M7 12h10" /></svg>
                </button>
              )}
            </div>
          </label>
          <button className="vf-btn red" disabled={busy}>{busy ? "Checking" : "Check"}</button>
        </form>
        {err && <p className="vf-err" id="vf-err" role="alert">{err}</p>}
        {scanning && (
          <div className="vf-cam">
            <video ref={video} muted playsInline />
            <span>Point the camera at the QR label</span>
          </div>
        )}
      </section>

      <section className="vf-center" aria-live="polite">
        {res?.genuine ? (
          <div className="vf-card">
            <span className="vf-ic ok" aria-hidden><svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg></span>
            <h1>Genuine E-Cinema product</h1>
            <p className="vf-text">
              Code {res.code} was made for this item and {res.first ? "scanned for the first time today." : `has been checked ${res.scans} times, first ${when(res.firstAt)}.`}
            </p>
            <div className="vf-p">
              <ProductArt id={artFor(res.product ?? "")} name={res.product ?? ""} className="vf-photo" size={40} />
              <div>
                <b>{res.product}</b>
                <span>Made by {res.licensee?.name} · licensed partner · licence {res.licensee?.licence}</span>
              </div>
            </div>
            <a className="vf-btn ghost" href={`/licensing#${res.licensee?.licence ?? ""}`}>See the licensed partner</a>
          </div>
        ) : res ? (
          <div className="vf-card">
            <span className="vf-ic bad" aria-hidden><svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round"><path d="M7 7l10 10M17 7L7 17" /></svg></span>
            <h1>This code is not genuine</h1>
            <p className="vf-text">{notGenuineText(res)}</p>
            <div className="vf-p col">
              <b>Help us stop it and earn a reward</b>
              <span>Tell us where you bought it. Confirmed reports earn ₦5,000 to ₦50,000.</span>
            </div>
            <a className="vf-btn red wide" href={`/rewards/report?code=${encodeURIComponent(res.code)}`}>Report this seller</a>
          </div>
        ) : (
          <div className="vf-card idle">
            <span className="vf-ic idle" aria-hidden><svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><rect x="4" y="4" width="6" height="6" rx="1" /><rect x="14" y="4" width="6" height="6" rx="1" /><rect x="4" y="14" width="6" height="6" rx="1" /><path d="M14 14h2v2M20 14v6h-6M17 17v3" /></svg></span>
            <h1>Is it really E-Cinema?</h1>
            <p className="vf-text">Every official E‑Cinema item carries a hologram and a QR label with its own code. Scan it with your phone camera, or type the code above.</p>
            <a className="vf-btn ghost" href="/rewards">Community rewards</a>
          </div>
        )}
      </section>
    </>
  );
}
