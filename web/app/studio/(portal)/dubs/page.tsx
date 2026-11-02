import Link from "next/link";
import StudioDubs from "@/components/studio/StudioDubs";
import { session } from "@/lib/licensing";
import type { Dub, DubLine } from "@/lib/dub-types";
import { myStudio, studioPage } from "@/lib/studio";
import { can, type Upload } from "@/lib/studio-types";

// Figma "Studio / AI dubbing and subtitles" (35:871), one film at a time.
export const metadata = { title: "AI dubbing · Studio · E-Cinema", robots: { index: false } };

export default async function StudioDubsPage({ searchParams }: { searchParams: Promise<{ film?: string; lang?: string }> }) {
  const { film, lang } = await searchParams;
  const s = await session();
  const [mine, r] = await Promise.all([myStudio(s), studioPage<{ uploads: Upload[] }>(s, "uploads")]);
  const uploads = r?.uploads ?? [];
  const u = uploads.find((x) => x.id === film) ?? uploads[0];
  if (!u) {
    return (
      <div className="pt-body">
        <header className="bp-head"><div><h1>AI dubbing and subtitles</h1><p>Dub a film into other languages once it is uploaded.</p></div></header>
        <section className="bp-panel"><p className="pt-hint">No films yet. <Link href="/studio/upload">Upload a film</Link> with its subtitle file to start dubbing.</p></section>
      </div>
    );
  }
  const d = await studioPage<{ dubs: Dub[] }>(s, `uploads/${u.id}/dubs`);
  if (!d) return <div className="pt-body"><p className="vf-err">Could not load the dubs for this film. Refresh to try again.</p></div>;
  const pick = d.dubs.find((x) => x.lang === lang) ?? d.dubs.find((x) => x.status === "review") ?? d.dubs[0];
  const first = pick ? await studioPage<{ dub: Dub; lines: DubLine[] }>(s, `uploads/${u.id}/dubs/${pick.lang}`) : null;
  return (
    <StudioDubs key={u.id} films={uploads.map((x) => ({ id: x.id, title: x.title }))} upload={u} dubs={d.dubs}
      selected={pick?.lang ?? null} lines={first?.lines ?? []} canEdit={can(mine?.studio?.role ?? "viewer", "edit")} />
  );
}
