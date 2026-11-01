import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { DashShell, SidebarToggle } from "@/components/dash/DashShell";
import NotificationList, { MarkAllRead } from "@/components/notifications/NotificationList";
import { currentAccount, SESSION_COOKIE } from "@/lib/auth";
import { myNotifications, type Category } from "@/lib/notifications";

// Built from the Figma frame "Web / Notifications" (31:878).
export const dynamic = "force-dynamic";
export const metadata = { title: "Notifications · E-Cinema" };

const CHIPS: { id: Category; label: string }[] = [
  { id: "all", label: "All" }, { id: "premieres", label: "Premieres" }, { id: "social", label: "Social" }, { id: "payments", label: "Payments" },
];
const EMPTY: Record<Category, string> = {
  all: "Nothing yet. Reminders, invites and payments show up here.",
  premieres: "No premiere news yet. We remind you an hour before each film you have a seat for.",
  social: "Nothing from friends yet. Party invites and shared collections show up here.",
  payments: "No payments yet. Receipts, refunds and lottery wins show up here.",
};

export default async function NotificationsPage({ searchParams }: { searchParams: Promise<{ category?: string }> }) {
  const me = await currentAccount();
  if (!me) redirect("/signin?next=/notifications");
  const session = (await cookies()).get(SESSION_COOKIE)?.value ?? "";
  const asked = (await searchParams).category;
  const category: Category = CHIPS.find((c) => c.id === asked)?.id ?? "all";
  const data = await myNotifications(session, category);

  return (
    <DashShell defaultOpen>
      <main className="tk nt">
        <div className="tk-head">
          <div className="tk-title"><SidebarToggle /><h1>Notifications</h1></div>
          <div className="tk-chips nt-chips">
            {CHIPS.map((c) => <Link key={c.id} href={c.id === "all" ? "/notifications" : `/notifications?category=${c.id}`} className={c.id === category ? "on" : ""} aria-current={c.id === category ? "page" : undefined}>{c.label}</Link>)}
            <MarkAllRead disabled={!data?.unread} />
          </div>
        </div>
        {data ? <NotificationList notes={data.notifications} empty={EMPTY[category]} /> : <p className="muted">Notifications could not load. Please try again in a moment.</p>}
      </main>
    </DashShell>
  );
}
