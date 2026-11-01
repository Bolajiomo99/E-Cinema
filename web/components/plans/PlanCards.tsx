"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { money, PLANS, priceOf, YEARLY_SAVING, type Currency, type Cycle, type PlanId } from "@/lib/plans";

const COPY: Record<PlanId, string> = {
  free: "Watch premieres with single tickets and join rooms as a listener.",
  student: "Most of Pro at a student price. Verified with a school email or ID.",
  pro: "Talk, share and request. The full E‑Cinema experience.",
  vip: "Book 5 to 50 seats together and pay less per seat.",
  enterprise: "Private screenings, invite-only rooms and team billing.",
};
const BADGE: Record<PlanId, string> = { free: "FREE", student: "STUDENT", pro: "PRO", vip: "VIP GROUP", enterprise: "ENTERPRISE" };

// Plan cards from Figma 18:421. Nothing looks picked until you point at a card; then it lights
// up red. Picking a plan while signed out starts sign-up with that plan chosen; signed in, it
// goes straight to Pay (or moves you to Free).
export default function PlanCards({ country, countryLabel, currency, signedIn, current, pending }: {
  country?: string; countryLabel: string; currency: Currency; signedIn: boolean; current?: PlanId; pending?: PlanId;
}) {
  const router = useRouter();
  const [cycle, setCycle] = useState<Cycle>("month");
  const [busy, setBusy] = useState<PlanId | null>(null);
  const [error, setError] = useState("");
  const [confirmFree, setConfirmFree] = useState(false);

  const pick = async (id: PlanId) => {
    setError("");
    if (!signedIn) return router.push(id === "free" ? "/join" : `/join?plan=${id}${cycle === "year" ? "&cycle=year" : ""}`);
    if (id === current) return;
    if (id === "free" && !confirmFree) return setConfirmFree(true);
    setBusy(id);
    const r = await fetch("/api/me/plan", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ plan: id }) });
    if (!r.ok) {
      setBusy(null);
      // Student Pro needs a verified student first (Figma 94:1327).
      if (id === "student" && r.status === 403) return router.push("/student");
      return setError(((await r.json().catch(() => ({}))) as { error?: string }).error ?? "Could not change your plan. Please try again.");
    }
    if (id === "free") { router.push("/settings/plan"); router.refresh(); }
    else router.push(`/join?step=4&plan=${id}${cycle === "year" ? "&cycle=year" : ""}`);
  };

  return (
    <>
      <header className="pl-head">
        <div>
          <p className="pl-eyebrow">PLANS</p>
          <h1>Pick how you want to watch</h1>
          <p>Cancel any time. Tickets you already bought stay yours.</p>
        </div>
        <div className="pl-head-r">
          <div className="pl-cycle" role="radiogroup" aria-label="Billing period">
            <button role="radio" aria-checked={cycle === "month"} className={cycle === "month" ? "on" : ""} onClick={() => setCycle("month")}>Monthly</button>
            <button role="radio" aria-checked={cycle === "year"} className={cycle === "year" ? "on" : ""} onClick={() => setCycle("year")}>Yearly · save {YEARLY_SAVING * 100}%</button>
          </div>
          <p>Prices for {countryLabel} in {currency} · <a href={signedIn ? "/settings/language" : "#locale"} data-open-locale>Change country</a></p>
        </div>
      </header>
      {error && <p className="pp-note pp-err" role="alert">{error}</p>}
      {confirmFree && (
        <p className="pp-note" role="alert">
          Moving to Free cancels your PayPal subscription straight away. <button className="st-link" onClick={() => pick("free")}>Yes, move to Free</button> · <button className="st-link" onClick={() => setConfirmFree(false)}>Keep my plan</button>
        </p>
      )}
      <div className="pl-cards">
        {PLANS.map((p) => {
          const price = priceOf(p.id, currency, cycle);
          const isCurrent = p.id === current;
          const label = isCurrent ? "Current plan"
            : busy === p.id ? "One moment…"
            : p.id === pending ? "Finish payment"
            : p.id === "free" ? (signedIn ? "Move to Free" : "Join free")
            : p.id === "pro" ? "Go Pro" : `Choose ${p.name === "VIP group" ? "VIP group" : p.name}`;
          return (
            <article key={p.id} id={p.id} className={`pl-card ${p.id}${isCurrent ? " current" : ""}`}>
              <div className="pl-card-h">
                <span className={`su-badge ${p.id}`}>{BADGE[p.id]}</span>
                {p.id === "pro" && <em>Most popular</em>}
                {isCurrent && <em className="cur">Your plan</em>}
              </div>
              <p className="pl-price">
                <b>{money(price, currency)}</b>
                <small>{p.id === "free" ? "forever" : p.per === "seat" ? (cycle === "year" ? "/seat/yr" : "/seat") : cycle === "year" ? "/year" : "/month"}</small>
              </p>
              <p className="pl-copy">{COPY[p.id]}</p>
              <span className="pl-push" />
              <button className={`pl-btn${p.id === "pro" || p.id === pending ? " red" : ""}`} disabled={isCurrent || busy !== null} onClick={() => pick(p.id)}>{label}</button>
            </article>
          );
        })}
      </div>
      {country === "NG" && <p className="pl-note">Paying with PayPal from Nigeria? PayPal bills in US dollars at the matching price.</p>}
    </>
  );
}
