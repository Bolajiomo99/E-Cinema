import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { DashShell, SidebarToggle } from "@/components/dash/DashShell";
import DownloadsManager, { type Owned, type Remote } from "@/components/downloads/DownloadsManager";
import { accountApi, currentAccount, SESSION_COOKIE } from "@/lib/auth";
import { findShowtime } from "@/lib/catalog";
import { myLibrary } from "@/lib/library";

// Built from the Figma frame "Web / Downloads" (31:743).
export const dynamic = "force-dynamic";
export const metadata = { title: "Downloads · E-Cinema" };

export default async function DownloadsPage() {
  const me = await currentAccount();
  if (!me) redirect("/signin?next=/downloads");
  const session = (await cookies()).get(SESSION_COOKIE)?.value ?? "";
  const [lib, dl] = await Promise.all([myLibrary(session), accountApi("GET", "/v1/me/downloads", undefined, session).catch(() => null)]);
  const owned: Owned[] = lib.items.filter((i) => i.owned).map((i) => {
    const s = findShowtime(i.showtimeId);
    return { id: i.showtimeId, film: i.film, language: s?.language ?? "English", runtimeMin: s?.runtimeMin ?? 120, colors: s?.poster ? [s.poster.from, s.poster.via] : ["#1b1b21", "#0e0e12"] };
  });
  const remote: Remote[] = dl?.status === 200 ? ((dl.body as { downloads: Remote[] }).downloads ?? []) : [];
  return (
    <DashShell defaultOpen>
      <main className="tk dl">
        <DownloadsManager owned={owned} remote={remote} title={<div className="tk-title"><SidebarToggle /><h1>Downloads</h1></div>} />
      </main>
    </DashShell>
  );
}
