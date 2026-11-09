import LegalLayout, { Sections, Table } from "@/components/legal/LegalLayout";

// Figma "Web / Legal · Community rules" (92:1350).
export const metadata = { title: "Community rules · E-Cinema" };

export default function CommunityRules() {
  return (
    <LegalLayout here="/legal/community" title="Community rules" lead="Rooms are for watching together. These rules keep them fun in every language. AI translates and checks world chat and community posts; people review what it flags. Private messages are only looked at when someone reports them.">
      <Sections items={[
        ["Be kind", "No hate, threats, bullying or harassment, in any language."],
        ["No spoilers", "Spoilers are hidden behind a tap in world chat until the film ends."],
        ["No selling or spam", "No links to sell things, no begging and no repeated messages."],
        ["No recording", "Never record, stream or photograph the screen."],
      ]} />
      <Table head={["If someone breaks a rule", "What happens"]} rows={[
        ["First time", "A warning in the room"],
        ["Second time", "Muted for 24 hours"],
        ["Serious or repeated", "Removed from the room and the film"],
        ["Hate, threats or piracy", "Account closed"],
      ]} />
    </LegalLayout>
  );
}
