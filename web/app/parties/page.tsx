import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { DashShell, SidebarToggle } from "@/components/dash/DashShell";
import PartiesRow from "@/components/home/PartiesRow";
import Logo from "@/components/landing/Logo";
import { accountApi, currentAccount, SESSION_COOKIE } from "@/lib/auth";
import { endsAt, showtimes } from "@/lib/catalog";
import type { Party } from "@/lib/parties";

export const dynamic = "force-dynamic";
export const metadata = { title: "Watch parties · E-Cinema" };

export default async function PartiesPage() {
  const me = await currentAccount();
  if (!me) redirect("/signin?next=/parties");
  const session = (await cookies()).get(SESSION_COOKIE)?.value;
  const r = await accountApi("GET", "/v1/me/parties", undefined, session).catch(() => null);
  const list = r?.status === 200 && Array.isArray(r.body) ? (r.body as Party[]) : [];
  const next = showtimes.find((s) => endsAt(s) > nowMs()) ?? showtimes[0];
  return (
    <DashShell defaultOpen>
      <main id="main" className="cl">
        <div className="cl-top"><span className="dash-brand"><SidebarToggle /><Logo /></span></div>
        <PartiesRow parties={list} heroId={next.id} />
      </main>
    </DashShell>
  );
}

function nowMs() {
  return Date.now();
}
