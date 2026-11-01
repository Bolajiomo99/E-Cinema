import { redirect } from "next/navigation";
import TopNav from "@/components/dash/TopNav";
import { DashShell } from "@/components/dash/DashShell";
import FamilyApp from "@/components/family/FamilyApp";
import { currentAccount } from "@/lib/auth";
import { familyFor } from "@/lib/family";
import { kidsFilms } from "@/lib/kids-films";
import { readLocale } from "@/lib/locale";

// Figma "Web / Kids and family" (89:1020).
export const dynamic = "force-dynamic";
export const metadata = { title: "Family and kids · E-Cinema" };

export default async function FamilyPage() {
  const me = await currentAccount();
  if (!me) redirect("/signin?next=/family");
  const [f, loc] = await Promise.all([familyFor(), readLocale()]);
  if (!f) redirect("/signin?next=/family");
  return (
    <DashShell>
      <div className="lp cpg">
        <TopNav me={me} t={loc.t} country={loc.country} lang={loc.lang} />
        <main className="fm">
          <FamilyApp initial={f.family} active={f.active} kidsFilms={kidsFilms()} />
        </main>
      </div>
    </DashShell>
  );
}
