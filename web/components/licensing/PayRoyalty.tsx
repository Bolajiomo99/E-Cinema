"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import PayPalTicketButton from "@/components/PayPalTicketButton";
import { monthName, naira } from "@/lib/licensing-types";
import { pcall } from "./pcall";

// "Pay now" for a month's royalty (email 41, Figma 127:391): card or PayPal through PayPal.
// Opened straight away when the statement email links here with ?pay=YYYY-MM.
export default function PayRoyalty({ month, invoice, royaltyNgn, dueBy, payReady, autoOpen }: {
  month: string; invoice: string; royaltyNgn: number; dueBy: string; payReady: boolean; autoOpen?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(Boolean(autoOpen));
  const [done, setDone] = useState(false);
  if (!open) return <button className="vf-btn soft sm" onClick={() => setOpen(true)}>Pay now</button>;
  return (
    <div className="pt-pop" role="dialog" aria-label={`Pay ${monthName(month)} royalty`}>
      <div className="pt-pop-in bp-panel">
        <h2>Pay your {monthName(month)} royalty</h2>
        {done ? <p className="bp-flash" role="status">Paid. Invoice {invoice} is settled.</p> : (
          <>
            <div className="pt-v"><div><b>Invoice {invoice}</b><small>Due by {new Date(dueBy + "T00:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "long", timeZone: "UTC" })}</small></div><strong>{naira(royaltyNgn)}</strong></div>
            <p className="pt-hint">Pay by card or PayPal, charged in your currency. Bank transfer is coming soon.</p>
            {payReady
              ? <PayPalTicketButton label={`Pay ${naira(royaltyNgn)}`} create={async () => (await pcall<{ orderId: string }>("POST", "partner/royalty", { month })).orderId} onPaid={() => { setDone(true); router.refresh(); }} />
              : <p className="ap-note">Payments are being switched on. Email admin@e-cinema.net with invoice {invoice} to pay.</p>}
          </>
        )}
        <div className="ap-act"><button className="vf-btn ghost" onClick={() => setOpen(false)}>Close</button></div>
      </div>
    </div>
  );
}
