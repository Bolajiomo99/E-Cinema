"use client";

import Link from "next/link";
import { useState } from "react";
import PayPalTicketButton from "@/components/PayPalTicketButton";
import LocalPayButton from "./LocalPayButton";

type Opt = { id: string; name: string; ready: boolean };

// "Try another way" list and buttons from Figma 96:1254. Providers without live keys show "Soon".
export default function TryAnother({ options, showtimeId, quality, total, retryHref }: { options: Opt[]; showtimeId: string; quality: string; total: string; retryHref: string }) {
  const [pick, setPick] = useState(options.find((o) => o.ready)?.id ?? "");
  return (
    <>
      <p className="pf-label">Try another way</p>
      <div className="pf-opts" role="radiogroup" aria-label="Another way to pay">
        {options.map((o) => (
          <button key={o.id} type="button" role="radio" aria-checked={pick === o.id} disabled={!o.ready} className={`pf-opt${pick === o.id ? " on" : ""}`} onClick={() => setPick(o.id)}>
            <span>{o.name}</span>
            {pick === o.id ? (
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="#e3182d" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="m3 8.5 3 3 7-7" /></svg>
            ) : !o.ready ? <span className="soon-tag">Soon</span> : null}
          </button>
        ))}
      </div>
      <div className="pf-btns">
        {pick === "paypal"
          ? <PayPalTicketButton showtimeId={showtimeId} quality={quality} label={`Pay ${total}`} className="state-btn primary pf-pay" />
          : pick === "paystack" || pick === "flutterwave"
            ? <LocalPayButton provider={pick} showtimeId={showtimeId} quality={quality} label={`Pay with ${pick === "paystack" ? "Paystack" : "Flutterwave"}`} className="state-btn primary pf-pay" />
            : <button type="button" className="state-btn primary pf-pay" disabled>Pay {total}</button>}
        <Link href={retryHref} className="state-btn ghost">Try the card again</Link>
      </div>
    </>
  );
}
