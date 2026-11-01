import CookieChoices from "@/components/legal/CookieChoices";
import LegalLayout, { Table, UPDATED } from "@/components/legal/LegalLayout";

// Figma "Web / Legal · Cookies" (92:957).
export const metadata = { title: "Cookies · E-Cinema" };

export default function CookiesPage() {
  return (
    <LegalLayout here="/cookies" title="Cookies" lead={`Choose what we may store on your device · ${UPDATED}`}>
      <CookieChoices />
      <h2 className="lg-full-h">Cookies we set</h2>
      <Table head={["Name", "What it does", "Kept for"]} rows={[
        ["__Host-ecs", "Keeps you signed in on this device. Essential.", "30 days"],
        ["ec_country", "Your verified country, for prices and the films you can see. Essential.", "1 year"],
        ["ec_lang", "The language you chose for the site and subtitles. Essential.", "1 year"],
        ["ec_consent", "Remembers the choices on this page. Essential.", "1 year"],
      ]} />
      <p>We do not run performance, personalisation or advertising cookies yet. If we add any, they stay off for you until you turn them on here.</p>
    </LegalLayout>
  );
}
