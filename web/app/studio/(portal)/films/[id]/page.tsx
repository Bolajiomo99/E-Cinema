import { notFound } from "next/navigation";
import StudioFilmDetail, { type FilmTab } from "@/components/studio/StudioFilmDetail";
import { LanguagesTab, PreSalesTab, RightsTab } from "@/components/studio/StudioFilmTabs";
import type { Dub } from "@/lib/dub-types";
import { session } from "@/lib/licensing";
import type { Premiere } from "@/lib/premiere-types";
import { myStudio, studioPage } from "@/lib/studio";
import { can, type PremierePlan, type Sales, type Upload } from "@/lib/studio-types";

// Figma "Studio / Film detail" (99:247), for a film the studio is preparing. Each tab reads
// only what it shows.
export const metadata = { title: "Film · Studio · E-Cinema", robots: { index: false } };

const TABS: FilmTab[] = ["details", "languages", "rights", "pre-sales"];

export default async function StudioFilmPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const want = (await searchParams).tab as FilmTab | undefined;
  const tab: FilmTab = want && TABS.includes(want) ? want : "details";
  const s = await session();
  const [mine, r, p] = await Promise.all([myStudio(s), studioPage<{ upload: Upload }>(s, `uploads/${id}`), studioPage<{ plan: PremierePlan | null }>(s, `uploads/${id}/plan`)]);
  if (!r?.upload) notFound();
  const role = mine?.studio?.role ?? "viewer";
  const plan = p?.plan ?? null;
  const rightsDeclared = Boolean(mine?.studio?.rightsAt);
  let body: React.ReactNode = null;
  if (tab === "languages") {
    const d = await studioPage<{ dubs: Dub[] }>(s, `uploads/${id}/dubs`);
    body = <LanguagesTab upload={r.upload} dubs={d ? d.dubs ?? [] : null} canEdit={can(role, "edit")} />;
  } else if (tab === "rights") {
    const [pr, lk] = await Promise.all([studioPage<{ premiere: Premiere }>(s, `uploads/${id}/premiere`), plan ? studioPage<{ leaks: { id: string; showtimeId: string; status: "open" | "takedown_sent" | "taken_down" | "allowed" }[] }>(s, "leaks") : null]);
    body = <RightsTab upload={r.upload} plan={plan} premiere={pr?.premiere ?? null} leaks={plan ? lk?.leaks ?? null : []} rightsDeclared={rightsDeclared} />;
  } else if (tab === "pre-sales") {
    const sl = plan ? await studioPage<{ sales: Sales | null }>(s, `uploads/${id}/sales`) : null;
    body = <PreSalesTab plan={plan} sales={sl?.sales ?? null} />;
  }
  return (
    <StudioFilmDetail key={r.upload.id} tab={tab} upload={r.upload} plan={plan} canEdit={can(role, "edit")} isOwner={role === "owner"} rightsDeclared={rightsDeclared}>
      {body}
    </StudioFilmDetail>
  );
}
