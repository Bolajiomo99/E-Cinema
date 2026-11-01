import Link from "next/link";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { DashShell, SidebarToggle } from "@/components/dash/DashShell";
import RewatchForm from "@/components/library/RewatchForm";
import { accountApi, currentAccount, SESSION_COOKIE } from "@/lib/auth";
import { findShowtime } from "@/lib/catalog";

// "Rewatch with friends" from the Library hero (Figma 19:583).
export const dynamic = "force-dynamic";
export const metadata = { title: "Rewatch with friends · E-Cinema" };

export default async function RewatchStart({ params }: { params: Promise<{ showtime: string }> }) {
  const { showtime } = await params;
  const s = findShowtime(showtime);
  if (!s) notFound();
  const me = await currentAccount();
  if (!me) redirect(`/signin?next=/library/rewatch/${showtime}`);
  const session = (await cookies()).get(SESSION_COOKIE)?.value ?? "";
  const access = await accountApi("GET", `/v1/me/library/${encodeURIComponent(s.id)}`, undefined, session);
  return (
    <DashShell defaultOpen>
      <main className="tk rw">
        <div className="tk-head">
          <div>
            <div className="tk-title"><SidebarToggle /><h1>Rewatch with friends</h1></div>
            <p>{s.film} · everyone presses play at the same moment, wherever they are.</p>
          </div>
        </div>
        {access.status === 200 ? <RewatchForm showtimeId={s.id} /> : (
          <div className="tk-empty">
            <h2>{access.status === 403 ? "The replay window has closed" : "This film is not in your library"}</h2>
            <p>{access.status === 403 ? "Keep the film to watch it again with friends." : "Films you watch at a premiere stay in your library for 30 days."}</p>
            <Link href={`/library?film=${s.id}`} className="state-btn primary">Back to your library</Link>
          </div>
        )}
      </main>
    </DashShell>
  );
}
