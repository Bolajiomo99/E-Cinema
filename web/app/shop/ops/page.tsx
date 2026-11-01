import { notFound } from "next/navigation";
import TopNav from "@/components/dash/TopNav";
import { DashShell } from "@/components/dash/DashShell";
import OrderDesk from "@/components/store/OrderDesk";
import { accountApi, currentAccount } from "@/lib/auth";
import { readLocale } from "@/lib/locale";
import { isStaff } from "@/lib/store";
import type { Order } from "@/lib/store-types";

// The delivery team's order desk. Staff only (STAFF_EMAILS); everyone else gets a 404.
export const dynamic = "force-dynamic";
export const metadata = { title: "Order desk · E-Cinema", robots: { index: false } };

export default async function OrderDeskPage() {
  const me = await currentAccount();
  if (!isStaff(me?.email)) notFound();
  const loc = await readLocale();
  const r = await accountApi("GET", "/v1/shop/orders/open");
  const orders = r.status === 200 ? (r.body as { orders: Order[] }).orders : [];
  return (
    <DashShell>
      <div className="lp sh">
        <TopNav me={me} active="shop" t={loc.t} country={loc.country} lang={loc.lang} />
        <main className="ord">
          <h1 className="ct-h1">Order desk</h1>
          <OrderDesk initial={orders} />
        </main>
      </div>
    </DashShell>
  );
}
