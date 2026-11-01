"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import PayPalTicketButton from "@/components/PayPalTicketButton";

// The pay step of the 18+ unlock (Figma 28:839): adult PIN, a one-time code, then PayPal.
export default function UnlockFlow({ showtimeId, stage, price, verified, pinSet }: { showtimeId: string; stage: number; price: string; verified: boolean; pinSet: boolean }) {
  const router = useRouter();
  const [hasPin, setHasPin] = useState(pinSet);
  const [newPin, setNewPin] = useState("");
  const [pin, setPin] = useState("");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const post = (action: string, body: unknown) =>
    fetch(`/api/unlock/${showtimeId}/${action}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
      .then(async (r) => ({ ok: r.ok, status: r.status, body: (await r.json().catch(() => ({}))) as { error?: string; sentTo?: string; orderId?: string } }));

  if (!verified) return <Link href="/settings/account" className="ul-cta">Verify your age to start</Link>;

  if (!hasPin)
    return (
      <form className="ul-step" onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        const r = await post("pin", { pin: newPin });
        setBusy(false);
        if (r.status === 204 || r.ok) { setHasPin(true); setMsg(""); } else setMsg(r.body.error ?? "Could not save the PIN");
      }}>
        <label className="ul-field">
          <span>Choose an adult PIN (4 to 6 digits). You will enter it at every stage.</span>
          <input inputMode="numeric" autoComplete="new-password" pattern="[0-9]{4,6}" maxLength={6} value={newPin} onChange={(e) => setNewPin(e.target.value.replace(/\D/g, ""))} aria-label="New adult PIN" required />
        </label>
        {msg && <p className="ul-err" role="alert">{msg}</p>}
        <button className="ul-cta" disabled={busy || newPin.length < 4}>{busy ? "Saving…" : "Set adult PIN"}</button>
      </form>
    );

  return (
    <div className="ul-step">
      <div className="ul-row">
        <label className="ul-field">
          <span>Adult PIN</span>
          <input type="password" inputMode="numeric" autoComplete="off" maxLength={6} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))} aria-label="Adult PIN" />
        </label>
        <label className="ul-field">
          <span>One-time code {sent && <small>sent to {sent}</small>}</span>
          <div className="ul-code">
            <input inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} aria-label="One-time code" />
            <button type="button" className="ul-send" disabled={busy} onClick={async () => {
              setBusy(true);
              const r = await post("code", {});
              setBusy(false);
              if (r.ok) { setSent(r.body.sentTo ?? "your email"); setMsg(""); } else setMsg(r.body.error ?? "Could not send a code");
            }}>{sent ? "Send again" : "Send code"}</button>
          </div>
        </label>
      </div>
      {msg && <p className="ul-err" role="alert">{msg}</p>}
      <PayPalTicketButton
        className="ul-cta"
        label={`Pay stage ${stage} · ${price}`}
        disabled={pin.length < 4 || code.length !== 6}
        create={async () => {
          const r = await post("order", { pin, code });
          setMsg("");
          if (!r.ok || !r.body.orderId) throw new Error(r.body.error ?? "Could not start the payment.");
          return r.body.orderId;
        }}
        onPaid={() => { setPin(""); setCode(""); setSent(""); router.refresh(); }}
      />
    </div>
  );
}
