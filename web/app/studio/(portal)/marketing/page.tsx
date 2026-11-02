import StudioMarketing, { type Campaign, type ClipSet } from "@/components/studio/StudioMarketing";
import { session } from "@/lib/licensing";
import type { Dub } from "@/lib/dub-types";
import { myStudio, studioPage } from "@/lib/studio";
import { can, type Film, type Upload } from "@/lib/studio-types";

// Figma "Studio / Marketing" (39:779).
export const metadata = { title: "Marketing · Studio · E-Cinema", robots: { index: false } };
export const dynamic = "force-dynamic";

export default async function StudioMarketingPage({ searchParams }: { searchParams: Promise<{ film?: string }> }) {
  const { film } = await searchParams;
  const s = await session();
  const [mine, up, fl, cmp] = await Promise.all([
    myStudio(s), studioPage<{ uploads: Upload[] }>(s, "uploads"), studioPage<{ films: Film[] }>(s, "films"), studioPage<{ campaigns: Campaign[] }>(s, "campaigns"),
  ]);
  const uploads = up?.uploads ?? [];
  const u = uploads.find((x) => x.id === film) ?? uploads[0];
  const [clips, dubs] = u
    ? await Promise.all([studioPage<ClipSet>(s, `uploads/${u.id}/clips`), studioPage<{ dubs: Dub[] }>(s, `uploads/${u.id}/dubs`)])
    : [null, null];
  const role = mine?.studio?.role ?? "viewer";
  return (
    <StudioMarketing key={u?.id ?? "none"} uploads={uploads.map((x) => ({ id: x.id, title: x.title }))} upload={u ?? null}
      clips={clips ?? { cutoffMs: 3_000_000, clips: [] }} languages={1 + (dubs?.dubs ?? []).filter((d) => d.status === "approved").length}
      films={(fl?.films ?? []).map((f) => ({ id: f.showtimeId, title: f.film, startsAt: f.startsAt, state: f.state }))}
      campaigns={cmp?.campaigns ?? []} canEdit={can(role, "marketing")} failed={!cmp || !fl} />
  );
}
