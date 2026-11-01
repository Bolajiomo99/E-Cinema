import { notFound } from "next/navigation";
import TopNav from "@/components/dash/TopNav";
import { DashShell } from "@/components/dash/DashShell";
import HiringDesk from "@/components/careers/HiringDesk";
import { accountApi, currentAccount } from "@/lib/auth";
import type { Application, Board, Job, Quote } from "@/lib/careers-types";
import { countryOptions } from "@/lib/countries";
import { readLocale } from "@/lib/locale";
import { isStaff } from "@/lib/store";

// The hiring and sales desk: post roles, move applicants along, answer quote requests. Staff only.
export const dynamic = "force-dynamic";
export const metadata = { title: "Hiring desk · E-Cinema", robots: { index: false } };

export default async function HiringDeskPage() {
  const me = await currentAccount();
  if (!isStaff(me?.email)) notFound();
  const loc = await readLocale();
  const [jobs, apps, quotes, board] = await Promise.all([
    accountApi("GET", "/v1/careers/jobs"), accountApi("GET", "/v1/careers/applications"), accountApi("GET", "/v1/business/quotes"), accountApi("GET", "/v1/jobs"),
  ]);
  return (
    <DashShell>
      <div className="lp cpg">
        <TopNav me={me} t={loc.t} country={loc.country} lang={loc.lang} />
        <main className="ma">
          <header className="ma-head"><div><h1>Hiring desk</h1><p>Roles, applicants and group screening quotes</p></div></header>
          <HiringDesk
            jobs={(jobs.body as { jobs: Job[] | null })?.jobs ?? []}
            apps={(apps.body as { applications: Application[] | null })?.applications ?? []}
            quotes={(quotes.body as { quotes: Quote[] | null })?.quotes ?? []}
            share={(board.body as Board)?.ngShare ?? 40}
            countries={countryOptions()}
          />
        </main>
      </div>
    </DashShell>
  );
}
