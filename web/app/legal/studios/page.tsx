import Link from "next/link";
import LegalLayout, { Table } from "@/components/legal/LegalLayout";
import PrintButton from "@/components/legal/PrintButton";

// Figma "Web / Legal · Studio terms" (92:1248).
export const metadata = { title: "Studio terms · E-Cinema" };

export default function StudioTerms() {
  return (
    <LegalLayout here="/legal/studios" title="Studio terms" lead="For film studios and distributors selling on E‑Cinema. Read with the studio agreement you sign at onboarding.">
      <Table head={["Topic", "What we agree"]} rows={[
        ["Revenue split", "Studio keeps 70% of net ticket revenue, E‑Cinema keeps 30%"],
        ["Payouts", "Monthly, by the 15th, in your currency to a verified account"],
        ["Rights", "You confirm you own or license the film for each country you choose"],
        ["Pricing", "You set prices per country; E‑Cinema suggests fair local prices"],
        ["AI dubbing", "No dub goes live until you approve every line"],
        ["Piracy", "Every stream is watermarked; we take down leaks and share evidence"],
        ["Ending", "Either side can end with 30 days notice; booked premieres still run"],
      ]} />
      <div className="lg-btns">
        <PrintButton label="Download studio agreement" />
        <Link className="vf-btn red" href="/studio">Open Studio portal</Link>
      </div>
    </LegalLayout>
  );
}
