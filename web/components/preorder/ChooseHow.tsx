"use client";

import Link from "next/link";
import { useState } from "react";

export type Option = { id: string; name: string; sub: string; price: string; stages: { label: string; price: string; until: string }[] };

const Tick = () => (
  <svg viewBox="0 0 16 16" aria-hidden><path d="m3.5 8.5 3 3 6-7" fill="none" stroke="#22c55e" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
);

// "Choose how you watch" (Figma 52:956): the picked quality drives the stage prices and the button.
export default function ChooseHow({ film, options, initial, cta, perks }: { film: string; options: Option[]; initial: string; cta: string; perks: { text: string; soon?: boolean }[] }) {
  const [pick, setPick] = useState(options.find((o) => o.id === initial)?.id ?? options[0].id);
  const o = options.find((x) => x.id === pick)!;
  const short = pick === "4k" ? "4K" : pick === "vr" ? "VR" : "HD";
  return (
    <div className="po-r">
      <h2>Choose how you watch</h2>
      <div role="radiogroup" aria-label="Quality" className="po-opts">
        {options.map((x) => (
          <button key={x.id} type="button" role="radio" aria-checked={x.id === pick} className={`po-q${x.id === pick ? " on" : ""}`} onClick={() => setPick(x.id)}>
            <span className="po-dot" aria-hidden />
            <span className="po-t"><strong>{x.name}</strong><small>{x.sub}</small></span>
            <b>{x.price}</b>
          </button>
        ))}
      </div>
      {o.stages.length > 1 && <>
        <p className="po-label">Price goes up as release gets closer</p>
        <div className="po-stages">
          {o.stages.map((s, i) => (
            <div key={s.label} className={`po-stage${i === 0 ? " on" : ""}`}>
              <small>{s.label}</small>
              <b>{s.price}</b>
              <span>{s.until}</span>
            </div>
          ))}
        </div>
      </>}
      <ul className="po-perks">
        {perks.map((p) => <li key={p.text}><Tick />{p.text}{p.soon && <em className="soon-tag">Soon</em>}</li>)}
      </ul>
      <Link href={`/checkout?film=${film}${pick === "hd" ? "" : `&q=${pick}`}`} className="lp-btn po-cta">{cta} {short} · {o.price}</Link>
      <p className="po-pay">Pay with PayPal, card or Pay Later today. Paystack, Flutterwave, USSD and crypto switch on as each provider approves us. Charged now, refunded if cancelled.</p>
    </div>
  );
}
