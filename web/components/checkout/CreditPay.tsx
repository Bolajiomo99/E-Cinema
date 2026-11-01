"use client";

import { useState } from "react";

// "Pay with credit" for viewers whose gift credit covers the whole seat.
export default function CreditPay({ showtimeId, quality, label, balance }: { showtimeId: string; quality: string; label: string; balance: string }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  async function pay() {
    setBusy(true);
    setErr("");
    const r = await fetch("/api/checkout/credit", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ showtimeId, quality }) });
    if (r.ok) return window.location.assign(`/tickets/confirmed?film=${encodeURIComponent(showtimeId)}`);
    setBusy(false);
    setErr(((await r.json().catch(() => ({}))) as { error?: string }).error ?? "Could not pay with credit.");
  }
  return (
    <div className="co-credit">
      <button className="lp-btn lg secondary co-cta" onClick={pay} disabled={busy}>{busy ? "Paying…" : label}</button>
      <small>You have {balance} of gift credit.</small>
      {err && <p className="pp-note pp-err">{err}</p>}
    </div>
  );
}
