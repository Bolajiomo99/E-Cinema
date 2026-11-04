import { notFound } from "next/navigation";
import StudioFilmDetail from "@/components/studio/StudioFilmDetail";
import { session } from "@/lib/licensing";
import { myStudio, studioPage } from "@/lib/studio";
import { can, type PremierePlan, type Upload } from "@/lib/studio-types";

// Figma "Studio / Film detail" (99:247), for a film the studio is preparing.
export const metadata = { title: "Film · Studio · E-Cinema", robots: { index: false } };

export default async function StudioFilmPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const s = await session();
  const [mine, r, p] = await Promise.all([myStudio(s), studioPage<{ upload: Upload }>(s, `uploads/${id}`), studioPage<{ plan: PremierePlan | null }>(s, `uploads/${id}/plan`)]);
  if (!r?.upload) notFound();
  const role = mine?.studio?.role ?? "viewer";
  return <StudioFilmDetail key={r.upload.id} upload={r.upload} plan={p?.plan ?? null} canEdit={can(role, "edit")} isOwner={role === "owner"} rightsDeclared={Boolean(mine?.studio?.rightsAt)} />;
}
