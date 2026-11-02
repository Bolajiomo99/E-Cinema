import StudioComingSoon from "@/components/studio/StudioComingSoon";
import { session } from "@/lib/licensing";
import type { Premiere } from "@/lib/premiere-types";
import { myStudio, studioPage } from "@/lib/studio";
import { can, type Upload } from "@/lib/studio-types";

// Figma "Studio / Post a coming-soon film" (53:1512).
export const metadata = { title: "Post a coming-soon film · Studio · E-Cinema", robots: { index: false } };
export const dynamic = "force-dynamic";

export default async function ComingSoonPage({ searchParams }: { searchParams: Promise<{ film?: string }> }) {
  const { film } = await searchParams;
  const s = await session();
  const [mine, r] = await Promise.all([myStudio(s), studioPage<{ uploads: Upload[] }>(s, "uploads")]);
  const u = (r?.uploads ?? []).find((x) => x.id === film) ?? null;
  const pr = u ? await studioPage<{ premiere: Premiere }>(s, `uploads/${u.id}/premiere`) : null;
  return (
    <StudioComingSoon key={u?.id ?? "new"} upload={u} premiere={pr?.premiere ?? null}
      canEdit={can(mine?.studio?.role ?? "viewer", "edit")} rightsDeclared={Boolean(mine?.studio?.rightsAt)} />
  );
}
