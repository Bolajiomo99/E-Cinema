"use client";

import PayPalTicketButton from "@/components/PayPalTicketButton";
import LocalPayButton from "./LocalPayButton";
import { useMethod } from "./method-store";

// The checkout's main button follows the chosen method (Figma 18:533).
export default function PayCta({ fallback, showtimeId, quality, total, naira }: { fallback: string; showtimeId: string; quality: string; total: string; naira: string }) {
  const m = useMethod(fallback);
  if (m === "paystack" || m === "flutterwave")
    return <LocalPayButton provider={m} showtimeId={showtimeId} quality={quality} className="lp-btn lg co-cta" label={`Continue to ${m === "paystack" ? "Paystack" : "Flutterwave"} · ${naira}`} />;
  if (m === "card") return <PayPalTicketButton key="card" card showtimeId={showtimeId} quality={quality} label={`Pay by card · ${total}`} className="lp-btn lg co-cta" />;
  return <PayPalTicketButton key="paypal" showtimeId={showtimeId} quality={quality} label={`Continue to PayPal · ${total}`} className="lp-btn lg co-cta" />;
}
