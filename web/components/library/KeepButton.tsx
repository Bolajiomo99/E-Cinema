"use client";

import { useState } from "react";
import PayPalTicketButton from "@/components/PayPalTicketButton";

// "Keep forever" on a replay in the Library: buy the film for good (HD or 4K) through PayPal.
// The order is made on our server, so the price can never be changed in the browser.
export default function KeepButton({ showtimeId, hd, uhd, currency, kept }: { showtimeId: string; hd: string; uhd: string; currency: string; kept?: boolean }) {
  const [open, setOpen] = useState(false);
  const [quality, setQuality] = useState<"hd" | "4k">("hd");
  const [err, setErr] = useState("");
  const money = (v: string) => (currency === "USD" ? `$${v}` : `${currency} ${v}`);
  if (kept) return <p className="lib-ok" role="status">Paid. The film is yours to keep; it can take a moment to show as owned.</p>;
  if (!open) return <button type="button" className="lib-ghost" onClick={() => setOpen(true)}>Keep forever · {money(hd)}</button>;
  return (
    <div className="lib-keep" role="group" aria-label="Keep this film">
      <div className="lib-keep-q">
        <button type="button" className={quality === "hd" ? "on" : ""} aria-pressed={quality === "hd"} onClick={() => setQuality("hd")}>HD · {money(hd)}</button>
        <button type="button" className={quality === "4k" ? "on" : ""} aria-pressed={quality === "4k"} onClick={() => setQuality("4k")}>4K · {money(uhd)}</button>
      </div>
      <PayPalTicketButton
        key={quality}
        label={`Pay ${money(quality === "4k" ? uhd : hd)} with PayPal`}
        create={async () => {
          setErr("");
          const r = await fetch(`/api/library/${showtimeId}/keep`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ quality }) });
          const out = (await r.json().catch(() => ({}))) as { orderId?: string; error?: string };
          if (!r.ok || !out.orderId) {
            setErr(out.error ?? "Could not start the payment");
            throw new Error(out.error ?? "order failed");
          }
          return out.orderId;
        }}
        onPaid={() => window.location.assign(`/library?film=${showtimeId}&kept=1`)}
      />
      <p className="lib-muted">Yours for good, with encrypted downloads for offline viewing.</p>
      {err && <p className="lib-err" role="alert">{err}</p>}
    </div>
  );
}
