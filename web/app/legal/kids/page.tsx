import LegalLayout, { Sections, UPDATED } from "@/components/legal/LegalLayout";

// Figma "Web / Legal · Kids and family" (92:1152).
export const metadata = { title: "Kids and family policy · E-Cinema" };

export default function KidsPolicy() {
  return (
    <LegalLayout here="/legal/kids" title="Kids and family policy" lead={`Plain-language summary · ${UPDATED} · shown in your language`}>
      <Sections items={[
        ["Who controls a kids profile", "Profiles for children under 13 are created and managed by the account owner, who must be a verified adult."],
        ["What kids see", "Only films rated for their age in their country. No 18+ content, no adverts, and no world chat."],
        ["No talking to strangers", "Kids cannot use voice or text chat with people outside the family. They can send emoji reactions."],
        ["No surprise spending", "Every ticket, snack or merch purchase needs a parent to approve on their own phone."],
        ["Less data", "We collect only what the profile needs: a first name, an age band and watch history. No face check is done for kids."],
        ["Worried about something?", "Report it from any screen or write to kids@e-cinema.net. A person replies within 24 hours."],
      ]} />
    </LegalLayout>
  );
}
