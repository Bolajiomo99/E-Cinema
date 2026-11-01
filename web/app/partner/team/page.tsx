import TeamApp from "@/components/licensing/TeamApp";
import { myLicence, partnerPage, session } from "@/lib/licensing";
import type { Member } from "@/lib/licensing-types";

// Team: the people at the licensee who can use this dashboard (sidebar item in Figma 116:192).
export default async function PartnerTeam() {
  const s = await session();
  const [mine, m] = await Promise.all([myLicence(s), partnerPage<{ members: Member[] }>(s, "members")]);
  return <TeamApp members={m?.members ?? []} owner={mine?.licensee.role === "owner"} />;
}
