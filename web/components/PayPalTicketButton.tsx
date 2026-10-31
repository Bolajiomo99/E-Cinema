"use client";

import { useEffect, useRef, useState } from "react";
import { loadCoreSdkScript } from "@paypal/paypal-js/sdk-v6";
import type { OnApproveDataOneTimePayments } from "@paypal/paypal-js/sdk-v6";

type Status = "loading" | "ready" | "paying" | "paid" | "unavailable" | "error";

// Pass showtimeId to create a one-seat order, or orderId to pay an order the concierge prepared.
export default function PayPalTicketButton({ showtimeId, orderId }: { showtimeId?: string; orderId?: string }) {
  const [status, setStatus] = useState<Status>("loading");
  const startRef = useRef<(() => Promise<void>) | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const cfg = (await fetch("/api/paypal/config").then((r) => r.json())) as { clientId: string | null; environment: "sandbox" | "production" };
      if (!cfg.clientId) return !cancelled && setStatus("unavailable");
      const paypal = await loadCoreSdkScript({ environment: cfg.environment });
      if (!paypal || cancelled) return;
      const sdk = await paypal.createInstance({ clientId: cfg.clientId, components: ["paypal-payments"], pageType: "checkout" });
      const eligible = await sdk.findEligibleMethods();
      if (!eligible.isEligible("paypal")) return !cancelled && setStatus("unavailable");

      const session = sdk.createPayPalOneTimePaymentSession({
        onApprove: async ({ orderId }: OnApproveDataOneTimePayments) => {
          const res = await fetch(`/api/paypal/orders/${orderId}/capture`, { method: "POST" });
          setStatus(res.ok ? "paid" : "error");
        },
        onCancel: () => setStatus("ready"),
        onError: () => setStatus("error"),
      });

      startRef.current = async () => {
        setStatus("paying");
        const order = orderId ? Promise.resolve({ orderId }) : fetch("/api/paypal/orders", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ showtimeId }),
        }).then(async (r) => {
          if (!r.ok) throw new Error("order failed");
          return (await r.json()) as { orderId: string };
        });
        await session.start({ presentationMode: "auto" }, order);
      };
      if (!cancelled) setStatus("ready");
    })().catch(() => !cancelled && setStatus("error"));
    return () => {
      cancelled = true;
    };
  }, [showtimeId, orderId]);

  if (status === "paid") return <p className="pp-note pp-ok">Payment received. Your seat is booked.</p>;
  if (status === "unavailable") return <p className="pp-note">PayPal is not available right now.</p>;
  return (
    <div>
      <button className="pp-button" disabled={status !== "ready"} onClick={() => startRef.current?.().catch(() => setStatus("error"))}>
        {status === "loading" ? "Loading PayPal…" : status === "paying" ? "Waiting for PayPal…" : "Pay with PayPal"}
      </button>
      {status === "error" && <p className="pp-note pp-err">Something went wrong. You have not been charged.</p>}
    </div>
  );
}
