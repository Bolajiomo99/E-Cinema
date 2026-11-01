import StudioTeam from "@/components/studio/StudioTeam";
import { session } from "@/lib/licensing";
import { myStudio, studioPage } from "@/lib/studio";
import type { Member } from "@/lib/studio-types";

// Figma "Studio / Team and roles" (39:980).
export const metadata = { title: "Team · Studio · E-Cinema", robots: { index: false } };

export default async function StudioTeamPage() {
  const s = await session();
  const [mine, t] = await Promise.all([myStudio(s), studioPage<{ members: Member[] }>(s, "team")]);
  return <StudioTeam initial={t?.members ?? []} myRole={mine?.studio?.role ?? "viewer"} />;
}
