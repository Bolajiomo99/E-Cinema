import { cookies } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import TopNav from "@/components/dash/TopNav";
import { DashShell } from "@/components/dash/DashShell";
import MyApplications from "@/components/careers/MyApplications";
import { accountApi, currentAccount, SESSION_COOKIE } from "@/lib/auth";
import type { Application } from "@/lib/careers-types";
import { readLocale } from "@/lib/locale";

// Figma "Web / Careers · My applications" (114:1531).
export const dynamic = "force-dynamic";
export const metadata = { title: "My applications · E-Cinema careers" };

export default async function MyApplicationsPage() {
  const me = await currentAccount();
  if (!me) redirect("/signin?next=/careers/applications");
  const s = (await cookies()).get(SESSION_COOKIE)?.value;
  const [r, loc] = await Promise.all([accountApi("GET", "/v1/me/applications", undefined, s), readLocale()]);
  const apps = r.status === 200 ? ((r.body as { applications: Application[] | null }).applications ?? []) : [];
  return (
    <DashShell>
      <div className="lp cpg">
        <TopNav me={me} t={loc.t} country={loc.country} lang={loc.lang} />
        <main className="ma">
          <header className="ma-head">
            <div><h1>My applications</h1><p>Track every job you applied for at E‑Cinema</p></div>
            <Link className="vf-btn ghost" href="/careers/jobs">Find more roles</Link>
          </header>
          <MyApplications initial={apps} tz={loc.country === "NG" || !loc.country ? "Africa/Lagos" : "UTC"} />
        </main>
      </div>
    </DashShell>
  );
}
