import { redirect } from "next/navigation";
import ApplyFlow from "@/components/licensing/ApplyFlow";
import { DashShell } from "@/components/dash/DashShell";
import { accountApi, currentAccount } from "@/lib/auth";
import { session } from "@/lib/licensing";
import type { Application, Plan } from "@/lib/licensing-types";
import { readLocale } from "@/lib/locale";
import { countryName } from "@/lib/plans";
import { COUNTRIES } from "@/lib/worldmap";

// Built from the Figma frame "Licensee / Apply for a licence" (116:38).
export const dynamic = "force-dynamic";
export const metadata = { title: "Apply for a licence · E-Cinema" };

export default async function ApplyPage({ searchParams }: { searchParams: Promise<{ plan?: string }> }) {
  const sp = await searchParams;
  const plan = (["starter", "growth", "global"] as const).find((p) => p === sp.plan) as Plan["id"] | undefined;
  const me = await currentAccount();
  if (!me) redirect(`/join?next=${encodeURIComponent(`/licensing/apply${plan ? `?plan=${plan}` : ""}`)}`);
  const [s, loc] = await Promise.all([session(), readLocale()]);
  const r = await accountApi("GET", "/v1/me/licence-application", undefined, s);
  const b = r.status === 200 ? (r.body as { application: Application | null; identityOk: boolean }) : { application: null, identityOk: false };
  const countries = Object.keys(COUNTRIES).map((code) => ({ code, name: countryName(code) })).sort((a, b) => a.name.localeCompare(b.name));
  return (
    <DashShell>
      <div className="lp">
        <ApplyFlow initial={b.application} identityOk={b.identityOk} countries={countries} plan={plan} homeCountry={loc.country && COUNTRIES[loc.country] ? loc.country : "NG"} payReady={Boolean(process.env.PAYPAL_CLIENT_ID)} />
      </div>
    </DashShell>
  );
}
