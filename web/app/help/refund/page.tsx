import { cookies } from "next/headers";
import Link from "next/link";
import ProductArt from "@/components/store/ProductArt";
import { redirect } from "next/navigation";
import TopNav from "@/components/dash/TopNav";
import { DashShell } from "@/components/dash/DashShell";
import RefundForm, { type RefundInfo } from "@/components/help/RefundForm";
import { accountApi, currentAccount, SESSION_COOKIE } from "@/lib/auth";
import { readLocale } from "@/lib/locale";
import { myOrders, pricing } from "@/lib/store";
import { price } from "@/lib/store-types";

// Figma "Web / Help · Request a refund" (96:1426).
export const dynamic = "force-dynamic";
export const metadata = { title: "Request a refund · E-Cinema" };

const UUID = /^[0-9a-f-]{36}$/;

export default async function RefundPage({ searchParams }: { searchParams: Promise<{ order?: string }> }) {
  const sp = await searchParams;
  const me = await currentAccount();
  if (!me) redirect(`/signin?next=${encodeURIComponent(`/help/refund${sp.order ? `?order=${sp.order}` : ""}`)}`);
  const session = (await cookies()).get(SESSION_COOKIE)?.value ?? "";
  const loc = await readLocale();
  const px = await pricing(loc.country);
  const tz = loc.country === "NG" || !loc.country ? "Africa/Lagos" : "UTC";

  let card;
  if (sp.order && UUID.test(sp.order)) {
    const r = await accountApi("GET", `/v1/me/orders/${sp.order}/refund`, undefined, session);
    card = r.status === 200
      ? <RefundForm info={r.body as RefundInfo} px={px} tz={tz} />
      : <div className="rf-card"><h1>Request a refund</h1><p className="rf-sub">We could not find that order on your account.</p><Link className="vf-btn ghost" href="/help/refund">Choose another order</Link></div>;
  } else {
    // No order picked yet: list the ones that can still be asked about.
    const { orders } = await myOrders(session);
    const open = orders.filter((o) => o.status === "delivered" || o.status === "out");
    card = (
      <div className="rf-card">
        <h1>Request a refund</h1>
        <p className="rf-sub">Pick the order that went wrong. Tickets are refunded from <Link href="/tickets">your tickets</Link>.</p>
        {open.length === 0 && <p className="rf-sub">You have no delivered orders to ask about.</p>}
        {open.map((o) => (
          <Link key={o.id} className="rf-order rf-pick" href={`/help/refund?order=${o.id}`}>
            <span className="rf-img">{o.items[0] && <ProductArt id={o.items[0].productId} name={o.items[0].name} images={o.items[0].images} size={24} />}</span>
            <span><b>{o.items.map((i) => i.name).join(", ")}</b><small>Order {o.number} · {o.status === "out" ? "on the way" : "delivered"}</small></span>
            <em>{price(o.totalNgn, px)}</em>
          </Link>
        ))}
      </div>
    );
  }
  return (
    <DashShell>
      <div className="lp rf">
        <TopNav me={me} t={loc.t} country={loc.country} lang={loc.lang} />
        <main id="main" className="rf-center">{card}</main>
      </div>
    </DashShell>
  );
}
