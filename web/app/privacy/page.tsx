import Link from "next/link";
import FullPrivacy from "@/components/legal/FullPrivacy";
import LegalLayout, { Sections, UPDATED } from "@/components/legal/LegalLayout";

// Figma "Web / Legal · Privacy policy" (89:1091). The cookie banner in that frame is the
// site-wide CookieBanner.
export const metadata = { title: "Privacy policy · E-Cinema" };

export default function PrivacyPage() {
  return (
    <LegalLayout here="/privacy" title="Privacy policy" lead={`Plain-language summary · ${UPDATED} · shown in your language`}>
      <Sections items={[
        ["What we collect", "Your name, phone, email, country, the result of your face and ID check for one-account-per-person and age checks, what you watch, and how you pay. We never see your full card number."],
        ["What we never do", "We never sell your data. Face and ID checks are done by our verification partner and are never used for ads. Voice chat is not recorded."],
        ["Why we use it", "To keep one account per person, stop piracy, show prices in your currency, recommend films and keep rooms safe."],
        ["Your choices", "Download everything we hold about you, correct it, or delete your account at any time. Kids profiles are managed by the account owner."],
      ]} />
      <div className="lg-btns">
        <Link className="vf-btn soft" href="/settings/privacy">Download my data</Link>
        <Link className="vf-btn ghost" href="/account/delete">Delete my account</Link>
      </div>
      <FullPrivacy />
    </LegalLayout>
  );
}
