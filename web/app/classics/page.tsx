import { cookies } from "next/headers";
import ClassicsList from "@/components/classics/ClassicsList";
import { DashShell, SidebarToggle } from "@/components/dash/DashShell";
import Logo from "@/components/landing/Logo";
import { accountApi, currentAccount, SESSION_COOKIE } from "@/lib/auth";
import { CAN_REQUEST, type Classic } from "@/lib/classics";

// Figma "Web / Request a classic" (31:1055).
export const dynamic = "force-dynamic";
export const metadata = { title: "Bring back a classic · E-Cinema" };

export default async function ClassicsPage() {
  const me = await currentAccount();
  const session = (await cookies()).get(SESSION_COOKIE)?.value;
  const [list, prof] = await Promise.all([
    accountApi("GET", "/v1/classics", undefined, session).catch(() => null),
    me ? accountApi("GET", "/v1/me/profile", undefined, session).catch(() => null) : null,
  ]);
  const items = list?.status === 200 && Array.isArray(list.body) ? (list.body as Classic[]) : [];
  const p = prof?.status === 200 ? (prof.body as { plan?: string; planStatus?: string }) : undefined;
  const canRequest = Boolean(p && p.planStatus === "active" && p.plan && CAN_REQUEST.has(p.plan));

  return (
    <DashShell defaultOpen>
      <main id="main" className="cl">
        <div className="cl-top"><span className="dash-brand"><SidebarToggle /><Logo /></span></div>
        <div className="cl-head">
          <div>
            <h1>Bring back a classic</h1>
            <p>Pro and Enterprise only. When enough people ask, the studio schedules a one-night screening.</p>
          </div>
          <span className="lp-badge pro">PRO</span>
        </div>
        <ClassicsList items={items} canRequest={canRequest} signedIn={Boolean(me)} />
      </main>
    </DashShell>
  );
}
