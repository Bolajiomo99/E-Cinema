import TopNav from "@/components/dash/TopNav";
import { DashShell } from "@/components/dash/DashShell";
import VerifyApp from "@/components/brand/VerifyApp";
import LandingFooter from "@/components/landing/LandingFooter";
import { currentAccount } from "@/lib/auth";
import { readLocale } from "@/lib/locale";

// Built from the Figma frames "Web / Verify a product · Genuine" (114:1751) and "· Not genuine" (114:1818).
export const dynamic = "force-dynamic";
export const metadata = { title: "Verify a product · E-Cinema", description: "Check that E-Cinema merch is genuine: scan the QR label or type its code." };

export default async function VerifyPage({ searchParams }: { searchParams: Promise<{ code?: string }> }) {
  const [sp, me, loc] = await Promise.all([searchParams, currentAccount(), readLocale()]);
  const body = (
    <div className="lp vf">
      <TopNav me={me} active="shop" t={loc.t} country={loc.country} lang={loc.lang} />
      <main id="main">
        <VerifyApp initial={typeof sp.code === "string" ? sp.code.slice(0, 200) : undefined} />
      </main>
      <LandingFooter />
    </div>
  );
  return me ? <DashShell>{body}</DashShell> : body;
}
