import FullTerms from "@/components/legal/FullTerms";
import LegalLayout, { Sections, UPDATED } from "@/components/legal/LegalLayout";
import PrintButton from "@/components/legal/PrintButton";

// Figma "Web / Legal · Terms of use" (92:841).
export const metadata = { title: "Terms of use · E-Cinema" };

export default function TermsPage() {
  return (
    <LegalLayout here="/terms" title="Terms of use" lead={`Plain-language summary · ${UPDATED} · shown in your language`}>
      <Sections items={[
        ["Who can use E-Cinema", "Anyone 13 or older, with one verified account per person. Adult films need the 18+ check and unlock. Kids under 13 use a kids profile inside a parent account."],
        ["What a ticket gives you", "A ticket is a licence to watch that film once, live, at its premiere time, in your verified country. It is not a copy of the film."],
        ["What is not allowed", "Recording, screenshots, screen sharing, downloading without paying, sharing your account, using a VPN to change price, or reselling tickets. We block these and may close accounts that try."],
        ["Prices and payments", "Prices follow your verified country and currency and include local tax where the law asks. Plans renew until you cancel in Settings."],
        ["Ending your account", "You can leave any time. We may suspend accounts that break these terms or the community rules, and we tell you why."],
        ["If we disagree", "Talk to Help first. Nigerian law applies, and your own country’s consumer rights still protect you."],
      ]} />
      <div className="lg-btns">
        <PrintButton label="Download PDF" />
        <a className="vf-btn ghost" href="#full">Read the full legal text</a>
      </div>
      <FullTerms />
    </LegalLayout>
  );
}
