"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

// Free cancellation until 7 days before the screening: refunds the PayPal payment in full.
export default function CancelSeat({ holdId, film, until }: { holdId: string; film: string; until: string }) {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "confirm" | "busy" | "done">("idle");
  const [error, setError] = useState("");
  if (state === "done") return <span className="tk-cancelled" role="status">Refunded</span>;
  if (state === "idle") return <button type="button" className="state-btn ghost" onClick={() => setState("confirm")} title={`Free until ${until}`}>Cancel seat</button>;
  return (
    <span className="tk-confirm" role="group" aria-label={`Cancel your seat for ${film}`}>
      <span>Refund in full and give up this seat?</span>
      <button type="button" className="state-btn primary" disabled={state === "busy"} onClick={async () => {
        setState("busy"); setError("");
        const r = await fetch(`/api/tickets/${holdId}/cancel`, { method: "POST" }).catch(() => null);
        const b = (await r?.json().catch(() => ({}))) as { error?: string } | undefined;
        if (r?.ok) { setState("done"); router.refresh(); }
        else { setState("confirm"); setError(b?.error ?? "Could not cancel, try again"); }
      }}>{state === "busy" ? "Refunding…" : "Yes, refund"}</button>
      <button type="button" className="state-btn ghost" onClick={() => { setState("idle"); setError(""); }}>Keep it</button>
      {error && <small role="alert">{error}</small>}
    </span>
  );
}
