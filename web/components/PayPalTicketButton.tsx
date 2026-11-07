"use client";

import { useEffect, useRef, useState } from "react";
import { loadCoreSdkScript } from "@paypal/paypal-js/sdk-v6";
import type { OnApproveDataOneTimePayments } from "@paypal/paypal-js/sdk-v6";

type Status = "loading" | "ready" | "paying" | "paid" | "unavailable" | "error" | "signin";

// Pass showtimeId to create a one-seat order, or orderId to pay an order the concierge prepared.
// create: makes the order itself (the 18+ unlock stages); onPaid: runs after a good capture instead of redirecting.
// card: opens PayPal's guest card form (debit or credit card, no PayPal account) instead of the PayPal login.
export default function PayPalTicketButton({ showtimeId, orderId, quality, label = "Pay with PayPal", className = "pp-button", create, onPaid, disabled, card = false }: {
  showtimeId?: string; orderId?: string; quality?: string; label?: string; className?: string;
  create?: () => Promise<string>; onPaid?: () => void; disabled?: boolean; card?: boolean;
}) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const createRef = useRef(create);
  const paidRef = useRef(onPaid);
  useEffect(() => {
    createRef.current = create;
    paidRef.current = onPaid;
  });
  const [status, setStatus] = useState<Status>("loading");
  const [err, setErr] = useState("");
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
      const sdk = await paypal.createInstance({ clientId: cfg.clientId, components: ["paypal-payments", "paypal-guest-payments"], pageType: "checkout" });
      const eligible = await sdk.findEligibleMethods();
      if (!card && !eligible.isEligible("paypal")) return !cancelled && setStatus("unavailable");

      const handlers = {
        onApprove: async ({ orderId }: OnApproveDataOneTimePayments) => {
          const res = await fetch(`/api/paypal/orders/${orderId}/capture`, { method: "POST" });
          if (res.ok && paidRef.current) return paidRef.current();
          if (res.ok && showtimeId) return window.location.assign(`/tickets/confirmed?film=${encodeURIComponent(showtimeId)}`);
          if (!res.ok && showtimeId && !createRef.current) return failed((((await res.json().catch(() => ({}))) as { issue?: string }).issue) ?? "error");
          setStatus(res.ok ? "paid" : "error");
        },
        onCancel: () => setStatus("ready"),
        onError: () => (showtimeId && !createRef.current ? failed("error") : setStatus("error")),
      };
      // Card: PayPal's guest checkout takes the card details itself, no PayPal account needed.
      const session = card ? sdk.createPayPalGuestOneTimePaymentSession(handlers) : sdk.createPayPalOneTimePaymentSession(handlers);

      startRef.current = async () => {
        if (statusRef.current === "signin") return;
        setStatus("paying");
        const order = createRef.current ? createRef.current().then((id) => ({ orderId: id })) : orderId ? Promise.resolve({ orderId }) : fetch("/api/paypal/orders", {
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
        await session.start(card && buttonRef.current ? { presentationMode: "auto", targetElement: buttonRef.current } : { presentationMode: "auto" }, order);
      };
      if (!cancelled) setStatus("ready");
    })().catch(() => !cancelled && setStatus("error"));
    return () => {
      cancelled = true;
    };
  }, [showtimeId, orderId, quality, card]);

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
      <button ref={buttonRef} className={className} disabled={(status !== "ready" && status !== "error") || disabled} onClick={() => startRef.current?.().catch((e: Error) => { setErr(e.message === "signin" || e.message === "order failed" ? "" : e.message); setStatus(e.message === "signin" ? "signin" : "error"); })}>
        {status === "loading" ? (card ? "Loading the card form…" : "Loading PayPal…") : status === "paying" ? (card ? "Waiting for your card…" : "Waiting for PayPal…") : label}
      </button>
      {status === "error" && <p className="pp-note pp-err">{err || "Something went wrong."} You have not been charged.</p>}
    </div>
  );
}
