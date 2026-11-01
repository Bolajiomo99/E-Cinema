"use client";

import Link from "next/link";
import { useState } from "react";

type Out = { kind: string; showtimeId?: string; plan?: string; until?: string; creditCents?: number; error?: string };

export default function RedeemButton({ code, kind, showtimeId }: { code: string; kind: string; showtimeId?: string }) {
  const [busy, setBusy] = useState(false);
  const [out, setOut] = useState<Out | null>(null);
  const [err, setErr] = useState("");

  async function claim() {
    setBusy(true);
    setErr("");
    const r = await fetch(`/api/gifts/${encodeURIComponent(code)}`, { method: "POST" });
    const b = (await r.json().catch(() => ({}))) as Out;
    setBusy(false);
    if (!r.ok) return setErr(b.error ?? "Could not claim the gift. Please try again.");
    setOut(b);
  }

  if (out) {
    const credit = out.creditCents ? `$${(out.creditCents / 100).toFixed(2)}` : "";
    return (
      <div className="gf-done" role="status">
        <p>
          {out.kind === "seat" ? "The seat is yours. It is in My tickets, and the room opens 30 minutes before the film."
            : out.plan ? `Your ${out.plan === "vip" ? "VIP" : "Pro"} plan is on until ${new Date(out.until!).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}.`
            : out.kind === "credit" ? `${credit} of credit is in your account. It pays for seats at checkout.`
            : `You already pay for a plan, so we added ${credit} of credit instead. It pays for seats at checkout.`}
        </p>
        <Link href={out.kind === "seat" ? "/tickets" : showtimeId ? `/film/${showtimeId}` : "/browse"} className="lp-btn">{out.kind === "seat" ? "Go to My tickets" : "Find a premiere"}</Link>
      </div>
    );
  }
  return (
    <div className="gf-actions">
      <button className="lp-btn" onClick={claim} disabled={busy}>{busy ? "Claiming…" : kind === "seat" ? "Claim my seat" : "Claim my gift"}</button>
      {err && <p className="gf-err" role="alert">{err}</p>}
    </div>
  );
}
