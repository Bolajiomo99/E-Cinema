import { notFound } from "next/navigation";
import TopNav from "@/components/dash/TopNav";
import { DashShell } from "@/components/dash/DashShell";
import StudioDesk from "@/components/studio/StudioDesk";
import { currentAccount } from "@/lib/auth";
import { readLocale } from "@/lib/locale";
import { isStaff } from "@/lib/store";

// The studio desk: E-Cinema staff verify new studios before their first premiere.
export const dynamic = "force-dynamic";
export const metadata = { title: "Studio desk · E-Cinema", robots: { index: false } };

export default async function StudioDeskPage() {
  const me = await currentAccount();
  if (!me || !isStaff(me.email)) notFound();
  const loc = await readLocale();
  return (
    <DashShell>
      <div className="lp bp">
        <TopNav me={me} t={loc.t} country={loc.country} lang={loc.lang} />
        <main className="bp-body"><StudioDesk /></main>
      </div>
    </DashShell>
  );
}
