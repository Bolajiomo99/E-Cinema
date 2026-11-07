"use client";

import { useState } from "react";
import { setMethod } from "./method-store";
import PayLogo, { type PayBrand } from "@/components/pay/PayLogo";

export type Method = { id: string; name: string; sub: string; ready: boolean; icon: "paypal" | "card" | "phone" | "bank" | "crypto" };

// Each method shows the provider's real mark so buyers spot the one they know.
const brand = (m: Method): PayBrand =>
  m.id === "paypal" ? "paypal" : m.id === "paystack" ? "paystack" : m.id === "flutterwave" ? "flutterwave" : m.id === "crypto" ? "coinbase"
    : m.id === "card" ? (/Verve/.test(m.sub) ? "card-ng" : "card") : "bank";

// Payment method list from Figma 18:533. Card payments run through PayPal's checkout,
// which takes cards without a PayPal account; Paystack and Flutterwave open their own pages.
export default function Methods({ methods }: { methods: Method[] }) {
  const [pick, setPick] = useState(methods.find((m) => m.ready)?.id ?? methods[0]?.id);
  return (
    <div className="co-methods" role="radiogroup" aria-label="Payment method">
      {methods.map((m) => (
        <button key={m.id} type="button" role="radio" aria-checked={pick === m.id} disabled={!m.ready} className={`co-method${pick === m.id ? " on" : ""}`} onClick={() => { setPick(m.id); setMethod(m.id); }}>
          <i className="co-radio" />
          <PayLogo brand={brand(m)} />
          <span className="co-t"><strong>{m.name}</strong><small>{m.sub}</small></span>
          {!m.ready && <span className="soon-tag">Soon</span>}
        </button>
      ))}
    </div>
  );
}
