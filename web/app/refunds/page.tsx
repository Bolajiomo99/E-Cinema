import Link from "next/link";
import LegalLayout, { Table } from "@/components/legal/LegalLayout";

// Figma "Web / Legal · Refunds" (92:1060).
export const metadata = { title: "Refunds · E-Cinema" };

export default function RefundsPage() {
  return (
    <LegalLayout here="/refunds" title="Refunds" lead="Most refunds are automatic and go back to the way you paid. Bank and mobile-money refunds take 1 to 5 working days.">
      <Table head={["What happened", "What you get"]} rows={[
        ["Premiere cancelled or moved", "Full refund, automatic"],
        ["Stream failed on our side for 10+ minutes", "Full refund or a free seat at the next screening"],
        ["Pre-order cancelled by the studio", "Full refund, automatic"],
        ["You changed your mind on a pre-order", "Full credit until 48 hours before the premiere"],
        ["Shop item, unopened", "Refund within 14 days of delivery"],
        ["Snacks late or wrong", "Refund or replacement"],
        ["18+ access fee, not used", "Refund within 24 hours"],
        ["18+ charity, pastor or cleric gift", "Not refundable once forwarded to the recipient"],
      ]} />
      <div className="lg-btns">
        <Link className="vf-btn red" href="/help/refund">Request a refund</Link>
        <Link className="vf-btn ghost" href="/concierge">Talk to Help</Link>
      </div>
    </LegalLayout>
  );
}
