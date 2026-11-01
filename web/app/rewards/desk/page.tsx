import { notFound } from "next/navigation";
import TopNav from "@/components/dash/TopNav";
import { DashShell } from "@/components/dash/DashShell";
import ReportDesk from "@/components/brand/ReportDesk";
import { accountApi, currentAccount } from "@/lib/auth";
import type { Report } from "@/lib/brand-types";
import { readLocale } from "@/lib/locale";
import { mediaEnabled, roomObjectLink } from "@/lib/media";
import { isStaff } from "@/lib/store";

// The brand investigators' desk for fake-seller reports.
export const dynamic = "force-dynamic";
export const metadata = { title: "Brand reports · E-Cinema", robots: { index: false } };

export default async function DeskPage() {
  const me = await currentAccount();
  if (!me || !isStaff(me.email)) notFound();
  const loc = await readLocale();
  const r = await accountApi("GET", "/v1/brand/reports/open");
  const raw = r.status === 200 ? (r.body as { reports: Report[] }).reports : [];
  const reports = await Promise.all(raw.map(async (x) => ({ ...x, photos: mediaEnabled ? await Promise.all(x.photos.map((k) => roomObjectLink(k))) : [] })));
  return (
    <DashShell>
      <div className="lp bp">
        <TopNav me={me} t={loc.t} country={loc.country} lang={loc.lang} />
        <main className="bp-body">
          <ReportDesk initial={reports} />
        </main>
      </div>
    </DashShell>
  );
}
