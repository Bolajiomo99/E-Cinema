import TopNav from "@/components/dash/TopNav";
import { DashShell } from "@/components/dash/DashShell";
import SearchBox from "@/components/search/SearchBox";
import { currentAccount } from "@/lib/auth";
import { readLocale } from "@/lib/locale";
import { search } from "@/lib/search";

// Built from the Figma frame "Web / Search (AI and voice)" (30:750).
export const dynamic = "force-dynamic";
export const metadata = { title: "Search · E-Cinema" };

export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const [{ q = "" }, me, loc] = await Promise.all([searchParams, currentAccount(), readLocale()]);
  const initial = q.trim() ? await search(q) : null;
  const body = (
    <div className="lp br">
      <TopNav me={me} active="home" t={loc.t} country={loc.country} lang={loc.lang} />
      <main id="main" className="sr-body">
        <h1 className="sr-only">Search</h1>
        <SearchBox initialQ={q} initial={initial} lang={loc.lang} />
      </main>
    </div>
  );
  return me ? <DashShell>{body}</DashShell> : body;
}
