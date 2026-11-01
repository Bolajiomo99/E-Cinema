"use client";

import { useState } from "react";

// Opens Paystack's or Flutterwave's own checkout page. The seat is held first, and it only
// counts as paid after we check with the provider when the buyer comes back.
export default function LocalPayButton({ provider, showtimeId, quality, label, className }: { provider: "paystack" | "flutterwave"; showtimeId: string; quality?: string; label: string; className?: string }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  return (
    <>
      <button
        type="button"
        className={className}
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setErr("");
          const r = await fetch(`/api/pay/${provider}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ showtimeId, quality }) });
          const b = (await r.json().catch(() => ({}))) as { url?: string; error?: string; signIn?: boolean; askParent?: boolean };
          if (r.ok && b.url) return window.location.assign(b.url);
          if (b.signIn) return window.location.assign(`/signin?next=${encodeURIComponent(location.pathname + location.search)}`);
          setBusy(false);
          setErr(b.askParent ? "Ask a grown-up to buy this from the kids cinema." : (b.error ?? "Could not start the payment, try again"));
        }}
      >
        {busy ? "Opening secure checkout…" : label}
      </button>
      {err && <p className="co-err" role="alert">{err}</p>}
    </>
  );
}
