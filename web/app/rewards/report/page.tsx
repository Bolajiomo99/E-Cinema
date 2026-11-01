import { redirect } from "next/navigation";
import TopNav from "@/components/dash/TopNav";
import { DashShell } from "@/components/dash/DashShell";
import ReportForm from "@/components/brand/ReportForm";
import { currentAccount } from "@/lib/auth";
import { readLocale } from "@/lib/locale";
import { mediaEnabled } from "@/lib/media";

// Built from the Figma frame "Web / Rewards · Report a fake seller" (114:1733).
export const dynamic = "force-dynamic";
export const metadata = { title: "Report a fake seller · E-Cinema" };

export default async function ReportPage({ searchParams }: { searchParams: Promise<{ code?: string }> }) {
  const sp = await searchParams;
  const code = typeof sp.code === "string" && /^EC-QR-[0-9A-Z]{4}-[0-9A-Z]{4}$/.test(sp.code) ? sp.code : undefined;
  const me = await currentAccount();
  if (!me) redirect(`/signin?next=${encodeURIComponent(`/rewards/report${code ? `?code=${code}` : ""}`)}`);
  const loc = await readLocale();
  return (
    <DashShell>
      <div className="lp bp">
        <TopNav me={me} t={loc.t} country={loc.country} lang={loc.lang} />
        <main className="bp-center">
          <ReportForm code={code} photosOn={mediaEnabled} />
        </main>
      </div>
    </DashShell>
  );
}
