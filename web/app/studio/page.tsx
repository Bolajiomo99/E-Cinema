import { redirect } from "next/navigation";
import StudioOnboarding from "@/components/studio/StudioOnboarding";
import StudioOverview from "@/components/studio/StudioOverview";
import StudioShell from "@/components/studio/StudioShell";
import { currentAccount } from "@/lib/auth";
import { countryOptions } from "@/lib/countries";
import { readLocale } from "@/lib/locale";
import { myStudio, studioPage } from "@/lib/studio";
import { session } from "@/lib/licensing";
import type { Film, Overview } from "@/lib/studio-types";

// The studio portal's front door: onboarding (Figma 34:49) until the studio is verified,
// then the overview (34:274).
export const dynamic = "force-dynamic";
export const metadata = { title: "Studio · E-Cinema", robots: { index: false } };

export default async function StudioHome() {
  const me = await currentAccount();
  if (!me) redirect("/signin?next=%2Fstudio");
  const s = await session();
  const mine = await myStudio(s);
  if (!mine) return <p className="pt-empty" style={{ padding: 32 }}>The studio portal could not load. Refresh to try again.</p>;
  if (!mine.studio || mine.studio.status !== "verified") {
    const loc = await readLocale();
    return <div className="stuo-wrap"><StudioOnboarding initial={mine} countries={countryOptions()} home={loc.country || "NG"} /></div>;
  }
  const [o, f] = await Promise.all([studioPage<Overview>(s, "overview"), studioPage<{ films: Film[] }>(s, "films")]);
  return (
    <StudioShell studio={mine.studio}>
        {o ? <StudioOverview o={o} films={f?.films ?? []} firstName={me.name.split(/\s+/)[0] ?? ""} /> : <p className="pt-empty pt-body">Your numbers could not load. Refresh to try again.</p>}
    </StudioShell>
  );
}
