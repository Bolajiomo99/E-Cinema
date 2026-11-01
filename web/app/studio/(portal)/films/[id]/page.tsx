import { notFound } from "next/navigation";
import StudioFilmDetail from "@/components/studio/StudioFilmDetail";
import { session } from "@/lib/licensing";
import { myStudio, studioPage } from "@/lib/studio";
import { can, type Upload } from "@/lib/studio-types";

// Figma "Studio / Film detail" (99:247), for a film the studio is preparing.
export const metadata = { title: "Film · Studio · E-Cinema", robots: { index: false } };

export default async function StudioFilmPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const s = await session();
  const [mine, r] = await Promise.all([myStudio(s), studioPage<{ upload: Upload }>(s, `uploads/${id}`)]);
  if (!r?.upload) notFound();
  return <StudioFilmDetail key={r.upload.id} upload={r.upload} canEdit={can(mine?.studio?.role ?? "viewer", "edit")} rightsDeclared={Boolean(mine?.studio?.rightsAt)} />;
}
