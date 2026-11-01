import { notFound } from "next/navigation";
import TopNav from "@/components/dash/TopNav";
import { DashShell } from "@/components/dash/DashShell";
import LicensingDesk from "@/components/licensing/LicensingDesk";
import { currentAccount } from "@/lib/auth";
import { readLocale } from "@/lib/locale";
import { isStaff } from "@/lib/store";

// The brand team's licensing desk: applications to approve, product designs to check, and
// royalty statements to mark settled. Only staff reach it.
export const dynamic = "force-dynamic";
export const metadata = { title: "Licensing desk · E-Cinema", robots: { index: false } };

export default async function LicensingDeskPage() {
  const me = await currentAccount();
  if (!me || !isStaff(me.email)) notFound();
  const loc = await readLocale();
  return (
    <DashShell>
      <div className="lp bp">
        <TopNav me={me} t={loc.t} country={loc.country} lang={loc.lang} />
        <main className="bp-body"><LicensingDesk /></main>
      </div>
    </DashShell>
  );
}
