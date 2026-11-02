import Link from "next/link";
import StudioControl, { type ControlData } from "@/components/studio/StudioControl";
import { accountApi } from "@/lib/auth";
import { session } from "@/lib/licensing";
import { myStudio, studioPage } from "@/lib/studio";
import { can, type Upload } from "@/lib/studio-types";

// Figma "Studio / Live control room" (37:1272): one published premiere at a time.
export const metadata = { title: "Live control room · Studio · E-Cinema", robots: { index: false } };
export const dynamic = "force-dynamic";

// Only films with a published premiere have a room: the one playing now first, then the next to start.
async function liveRooms(s: string, uploads: Upload[]) {
  const rooms = (await Promise.all(uploads.map(async (u) => {
    const c = await accountApi("GET", `/v1/me/studio/uploads/${u.id}/control`, undefined, s);
    return c.status === 200 ? { u, data: c.body as ControlData } : null;
  }))).filter((x) => x !== null);
  const now = Date.now();
  const rank = (d: ControlData) => {
    const st = Date.parse(d.control.startsAt), end = st + d.control.durationMin * 60_000;
    return now >= st && now < end ? -1e15 : st >= now ? st - now : 1e15 + (now - end);
  };
  return rooms.sort((a, b) => rank(a.data) - rank(b.data));
}

export default async function StudioControlPage({ searchParams }: { searchParams: Promise<{ film?: string }> }) {
  const { film } = await searchParams;
  const s = await session();
  const [mine, r] = await Promise.all([myStudio(s), studioPage<{ uploads: Upload[] }>(s, "uploads")]);
  const uploads = (r?.uploads ?? []).slice(0, 30);
  const rooms = await liveRooms(s, uploads);
  const pick = rooms.find((x) => x.u.id === film) ?? rooms[0];
  if (!pick) {
    return (
      <div className="pt-body">
        <header className="bp-head"><div><h1>Live control room</h1><p>Watch your premiere&apos;s audience as it happens.</p></div></header>
        <section className="bp-panel"><p className="pt-hint">No premieres yet. <Link href="/studio/premieres">Publish a premiere</Link> and its room shows here.</p></section>
      </div>
    );
  }
  return (
    <StudioControl key={pick.u.id} upload={pick.u.id} films={rooms.map((x) => ({ id: x.u.id, title: x.u.title }))} initial={pick.data}
      canEdit={can(mine?.studio?.role ?? "viewer", "edit")} />
  );
}
