import Link from "next/link";
import StudioPremieres from "@/components/studio/StudioPremieres";
import { usdRates } from "@/lib/fx";
import { session } from "@/lib/licensing";
import type { Premiere } from "@/lib/premiere-types";
import { myStudio, studioPage } from "@/lib/studio";
import { can, type Upload } from "@/lib/studio-types";

// Figma "Studio / Premieres and pricing" (35:514), one film at a time.
export const metadata = { title: "Premieres and pricing · Studio · E-Cinema", robots: { index: false } };

export default async function StudioPremieresPage({ searchParams }: { searchParams: Promise<{ film?: string }> }) {
  const { film } = await searchParams;
  const s = await session();
  const [mine, r] = await Promise.all([myStudio(s), studioPage<{ uploads: Upload[] }>(s, "uploads")]);
  const uploads = r?.uploads ?? [];
  const u = uploads.find((x) => x.id === film) ?? uploads[0];
  if (!u) {
    return (
      <div className="pt-body">
        <header className="bp-head"><div><h1>Premieres and pricing</h1><p>Book a premiere and set ticket prices once a film is uploaded.</p></div></header>
        <section className="bp-panel"><p className="pt-hint">No films yet. <Link href="/studio/upload">Upload a film</Link> to book its premiere, or <Link href="/studio/premieres/coming-soon">post a coming-soon film</Link> before the full film is ready.</p></section>
      </div>
    );
  }
  const [pr, rates] = await Promise.all([studioPage<{ premiere: Premiere }>(s, `uploads/${u.id}/premiere`), usdRates()]);
  if (!pr) return <div className="pt-body"><p className="vf-err">Could not load this premiere. Refresh to try again.</p></div>;
  return (
    <StudioPremieres key={u.id} films={uploads.map((x) => ({ id: x.id, title: x.title }))} upload={u} premiere={pr.premiere} rates={rates}
      canEdit={can(mine?.studio?.role ?? "viewer", "edit")} rightsDeclared={Boolean(mine?.studio?.rightsAt)} />
  );
}
