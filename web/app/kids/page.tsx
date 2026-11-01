import { redirect } from "next/navigation";
import TopNav from "@/components/dash/TopNav";
import { DashShell } from "@/components/dash/DashShell";
import KidsCinema from "@/components/family/KidsCinema";
import { currentAccount } from "@/lib/auth";
import { activeProfile } from "@/lib/family";
import { allowed } from "@/lib/family-types";
import { kidsFilms, whenText } from "@/lib/kids-films";
import { readLocale } from "@/lib/locale";

// The kids cinema (Figma 89:1020, "Ada's cinema").
export const dynamic = "force-dynamic";
export const metadata = { title: "Kids cinema · E-Cinema" };

export default async function KidsPage() {
  const me = await currentAccount();
  if (!me) redirect("/signin?next=/kids");
  const [active, loc] = await Promise.all([activeProfile(), readLocale()]);
  if (!active) redirect("/signin?next=/kids");
  const max = active.profile.kind === "kids" ? active.profile.maxRating : "all";
  const films = kidsFilms().filter((s) => allowed(s.rating, max));
  return (
    <DashShell>
      <div className="lp cpg">
        <TopNav me={me} t={loc.t} country={loc.country} lang={loc.lang} />
        <main className="fm">
          <KidsCinema active={active} films={films} lang={loc.lang ?? "en"} whenText={whenText(films)} />
        </main>
      </div>
    </DashShell>
  );
}
