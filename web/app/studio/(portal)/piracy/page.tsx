import StudioPiracy, { type LeakData } from "@/components/studio/StudioPiracy";
import { session } from "@/lib/licensing";
import { myStudio, studioPage } from "@/lib/studio";
import { can, type Film } from "@/lib/studio-types";

// Figma "Studio / Piracy protection" (39:578).
export const metadata = { title: "Piracy protection · Studio · E-Cinema", robots: { index: false } };
export const dynamic = "force-dynamic";

export default async function StudioPiracyPage() {
  const s = await session();
  const [mine, data, films] = await Promise.all([myStudio(s), studioPage<LeakData>(s, "leaks"), studioPage<{ films: Film[] }>(s, "films")]);
  return (
    <StudioPiracy initial={data ?? { leaks: [], stats: { found30: 0, foundPrev30: 0, takenDown: 0, toTakeDown: 0, medianHours: 0, banned: 0, traced: 0 } }}
      films={(films?.films ?? []).map((f) => ({ id: f.showtimeId, title: f.film }))} canEdit={can(mine?.studio?.role ?? "viewer", "edit")} failed={!data} />
  );
}
