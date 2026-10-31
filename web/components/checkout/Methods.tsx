"use client";

import { useState } from "react";

export type Method = { id: string; name: string; sub: string; ready: boolean; icon: "paypal" | "card" | "phone" | "bank" | "crypto" };

const ICONS: Record<Method["icon"], React.ReactNode> = {
  paypal: <span className="co-pp" aria-hidden>P</span>,
  card: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden><rect x="2.5" y="5" width="19" height="14" rx="2" /><path d="M2.5 10h19" /></svg>,
  phone: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden><rect x="6" y="2.5" width="12" height="19" rx="2" /><path d="M11 18.5h2" /></svg>,
  bank: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden><path d="M3 9.5 12 4l9 5.5M5 10v7M9.5 10v7M14.5 10v7M19 10v7M3 20h18" /></svg>,
  crypto: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden><path d="M8 5h6a3 3 0 0 1 0 6H8zM8 11h7a3 3 0 0 1 0 6H8zM8 3v18M11 3v2M11 19v2" /></svg>,
};

// Payment method list from Figma 18:533. Card payments run through PayPal's checkout,
// which takes cards without a PayPal account; local providers switch on when their keys land.
export default function Methods({ methods }: { methods: Method[] }) {
  const [pick, setPick] = useState(methods.find((m) => m.ready)?.id ?? methods[0]?.id);
  return (
    <div className="co-methods" role="radiogroup" aria-label="Payment method">
      {methods.map((m) => (
        <button key={m.id} type="button" role="radio" aria-checked={pick === m.id} disabled={!m.ready} className={`co-method${pick === m.id ? " on" : ""}`} onClick={() => setPick(m.id)}>
          <i className="co-radio" />
          <span className="co-icon">{ICONS[m.icon]}</span>
          <span className="co-t"><strong>{m.name}</strong><small>{m.sub}</small></span>
          {!m.ready && <span className="soon-tag">Soon</span>}
        </button>
      ))}
    </div>
  );
}
