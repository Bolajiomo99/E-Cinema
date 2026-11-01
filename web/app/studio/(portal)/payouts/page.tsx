import StudioPayouts from "@/components/studio/StudioPayouts";
import { session } from "@/lib/licensing";
import { myStudio, studioPage } from "@/lib/studio";
import { can, type Film, type Overview, type PayoutRow, type Studio } from "@/lib/studio-types";

// Figma "Studio / Revenue and payouts" (39:349). Owners, admins and finance only.
export const metadata = { title: "Revenue and payouts · Studio · E-Cinema", robots: { index: false } };

export default async function StudioPayoutsPage() {
  const s = await session();
  const mine = await myStudio(s);
  if (!mine?.studio) return null;
  if (!can(mine.studio.role, "money")) {
    return <div className="pt-body"><header className="bp-head"><div><h1>Revenue and payouts</h1><p>Only the owner, admins and finance can see money. Ask your studio owner for access.</p></div></header></div>;
  }
  const [p, f, o] = await Promise.all([
    studioPage<{ studio: Studio; payouts: PayoutRow[] }>(s, "payouts"),
    studioPage<{ films: Film[] }>(s, "films"),
    studioPage<Overview>(s, "overview"),
  ]);
  if (!p) return <p className="pt-empty pt-body">Your statement could not load. Refresh to try again.</p>;
  return <StudioPayouts studio={mine.studio} rows={p.payouts} films={f?.films ?? []} months={o?.months ?? []} canMoney />;
}
