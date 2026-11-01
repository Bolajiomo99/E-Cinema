import { notFound } from "next/navigation";
import StudioUpload from "@/components/studio/StudioUpload";
import { session } from "@/lib/licensing";
import { myStudio, studioPage } from "@/lib/studio";
import { can, type Upload } from "@/lib/studio-types";

// Figma "Studio / Upload · film file" (35:290).
export const metadata = { title: "Upload a film · Studio · E-Cinema", robots: { index: false } };

export default async function StudioUploadPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const s = await session();
  const [mine, r] = await Promise.all([myStudio(s), studioPage<{ upload: Upload }>(s, `uploads/${id}`)]);
  if (!r?.upload) notFound();
  const now = new Date().getTime();
  return <StudioUpload key={r.upload.id} upload={r.upload} canEdit={can(mine?.studio?.role ?? "viewer", "edit")} now={now} />;
}
