"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import PayPalTicketButton from "@/components/PayPalTicketButton";
import { naira, type Plan } from "@/lib/licensing-types";
import { pcall } from "./pcall";

// "Renew" (Figma 116:726): one more year on the current plan, or move up a plan, paid with PayPal.
export default function RenewLicence({ plans, current, payReady }: { plans: Plan[]; current: Plan["id"]; payReady: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [plan, setPlan] = useState<Plan["id"]>(current);
  const [done, setDone] = useState(false);
  if (!open) return <button className="vf-btn soft sm" onClick={() => setOpen(true)}>Renew</button>;
  const p = plans.find((x) => x.id === plan)!;
  return (
    <div className="pt-pop" role="dialog" aria-label="Renew licence">
      <div className="pt-pop-in bp-panel">
        <h2>Renew your licence</h2>
        {done ? <p className="bp-flash" role="status">Paid. Your licence now runs for another year.</p> : (
          <>
            <div className="ap-plans two">
              {plans.map((x) => (
                <button key={x.id} type="button" className={`ap-plan ${plan === x.id ? "on" : ""}`} aria-pressed={plan === x.id} onClick={() => setPlan(x.id)}>
                  <b>{x.id === current ? `Keep ${x.name}` : `Move to ${x.name}`}</b>
                  <strong>{naira(x.feeNgn)} a year</strong>
                  <em>+ {x.royaltyPct}% of sales</em>
                </button>
              ))}
            </div>
            <p className="pt-hint">The new year starts when your current one ends. Charged in your currency through PayPal.</p>
            {payReady ? <PayPalTicketButton label={`Pay ${naira(p.feeNgn)}`} create={async () => (await pcall<{ orderId: string }>("POST", "partner/renew", { plan })).orderId} onPaid={() => { setDone(true); router.refresh(); }} /> : <p className="ap-note">Payments are being switched on. Email admin@e-cinema.net to renew.</p>}
          </>
        )}
        <div className="ap-act"><button className="vf-btn ghost" onClick={() => setOpen(false)}>Close</button></div>
      </div>
    </div>
  );
}
