import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import TopNav from "@/components/dash/TopNav";
import { DashShell } from "@/components/dash/DashShell";
import OrdersApp from "@/components/store/OrdersApp";
import { currentAccount, SESSION_COOKIE } from "@/lib/auth";
import { readLocale } from "@/lib/locale";
import { myOrders, pricing } from "@/lib/store";

// Built from the Figma frame "Web / Orders and tracking" (89:894).
export const dynamic = "force-dynamic";
export const metadata = { title: "Your orders · E-Cinema shop" };

export default async function OrdersPage({ searchParams }: { searchParams: Promise<{ o?: string; placed?: string }> }) {
  const me = await currentAccount();
  const sp = await searchParams;
  if (!me) redirect(`/signin?next=${encodeURIComponent(`/shop/orders${sp.o ? `?o=${sp.o}` : ""}`)}`);
  const session = (await cookies()).get(SESSION_COOKIE)?.value ?? "";
  const loc = await readLocale();
  const [{ orders, reviewable }, px] = await Promise.all([myOrders(session), pricing(loc.country)]);
  return (
    <DashShell>
      <div className="lp sh">
        <TopNav me={me} active="shop" t={loc.t} country={loc.country} lang={loc.lang} />
        <main id="main" className="ord">
          <OrdersApp initial={orders} reviewable={reviewable} px={px} tz={loc.country === "NG" || !loc.country ? "Africa/Lagos" : "UTC"} focus={sp.o} placed={sp.placed === "1"} />
        </main>
      </div>
    </DashShell>
  );
}
