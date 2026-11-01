"use client";

import { useEffect, useRef, useState } from "react";
import { loadCoreSdkScript } from "@paypal/paypal-js/sdk-v6";
import type { OnApproveDataOneTimePayments } from "@paypal/paypal-js/sdk-v6";

type Status = "loading" | "ready" | "paying" | "paid" | "unavailable" | "error" | "signin";

// Pass showtimeId to create a one-seat order, or orderId to pay an order the concierge prepared.
export default function PayPalTicketButton({ showtimeId, orderId, quality, label = "Pay with PayPal", className = "pp-button" }: { showtimeId?: string; orderId?: string; quality?: string; label?: string; className?: string }) {
  const [status, setStatus] = useState<Status>("loading");
  const startRef = useRef<(() => Promise<void>) | null>(null);
  const statusRef = useRef<Status>("loading");
  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  // Figma 96:1254: a failed payment lands on a page that keeps the seat and offers another way.
  const failed = (why: string) =>
    window.location.assign(`/checkout/failed?film=${encodeURIComponent(showtimeId!)}${quality && quality !== "hd" ? `&q=${quality}` : ""}&why=${encodeURIComponent(why)}`);

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
          if (res.ok && showtimeId) return window.location.assign(`/tickets/confirmed?film=${encodeURIComponent(showtimeId)}`);
          if (!res.ok && showtimeId) return failed((((await res.json().catch(() => ({}))) as { issue?: string }).issue) ?? "error");
          setStatus(res.ok ? "paid" : "error");
        },
        onCancel: () => setStatus("ready"),
        onError: () => (showtimeId ? failed("error") : setStatus("error")),
      });

      startRef.current = async () => {
        if (statusRef.current === "signin") return;
        setStatus("paying");
        const order = orderId ? Promise.resolve({ orderId }) : fetch("/api/paypal/orders", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ showtimeId, quality }),
        }).then(async (r) => {
          if (r.status === 401) {
            setStatus("signin");
            throw new Error("signin");
          }
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
  }, [showtimeId, orderId, quality]);

  if (status === "paid")
    return (
      <p className="pp-note pp-ok">
        Payment received. Your seat is booked.{" "}
        {showtimeId && <a href={`/room/${showtimeId}`}>Go to your watch room</a>}
      </p>
    );
  if (status === "signin")
    return (
      <p className="pp-note">
        Tickets belong to your account. <a href="/signin?next=/checkout">Sign in</a> or <a href="/join">join free</a> to buy a seat.
      </p>
    );
  if (status === "unavailable") return <p className="pp-note">PayPal is not available right now. You have not been charged.</p>;
  return (
    <div>
      <button className={className} disabled={status !== "ready"} onClick={() => startRef.current?.().catch((e: Error) => setStatus(e.message === "signin" ? "signin" : "error"))}>
        {status === "loading" ? "Loading PayPal…" : status === "paying" ? "Waiting for PayPal…" : label}
      </button>
      {status === "error" && <p className="pp-note pp-err">Something went wrong. You have not been charged.</p>}
    </div>
  );
}
