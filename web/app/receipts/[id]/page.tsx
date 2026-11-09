import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { accountApi, currentAccount, SESSION_COOKIE } from "@/lib/auth";
import { findShowtime } from "@/lib/catalog";
import PrintButton from "./PrintButton";

export const dynamic = "force-dynamic";
export const metadata = { title: "Receipt · E-Cinema", robots: { index: false } };

// A printable receipt for a paid ticket ("PDF" in Plan and payments: print or save as PDF).
export default async function Receipt({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await currentAccount();
  const session = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!me || !session) redirect(`/signin?next=/receipts/${id}`);
  const r = await accountApi("GET", "/v1/me/tickets", undefined, session);
  const list = (Array.isArray(r.body) ? r.body : []) as { holdId: string; showtimeId: string; seats: number; status: string; orderId?: string; createdAt: string }[];
  const t = list.find((x) => x.holdId === id && x.status === "paid");
  if (!t) notFound();
  const st = findShowtime(t.showtimeId);
  const each = st ? Number(st.price.value) : 0;
  const fmt = (v: number) => new Intl.NumberFormat("en", { style: "currency", currency: st?.price.currency ?? "USD" }).format(v);
  return (
    <main id="main" className="receipt">
      <header><img src="/email/logo.png" width={116} height={34} alt="E-CINEMA" /><span>RECEIPT</span></header>
      <h1>Receipt</h1>
      <dl>
        <dt>Date</dt><dd>{new Intl.DateTimeFormat("en-GB", { dateStyle: "long", timeStyle: "short", timeZone: "Africa/Lagos" }).format(new Date(t.createdAt))}</dd>
        <dt>Billed to</dt><dd>{me.name} · {me.email}</dd>
        <dt>Item</dt><dd>{st?.film ?? t.showtimeId} premiere{st ? `, ${new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Africa/Lagos" }).format(new Date(st.startsAt))} WAT` : ""}</dd>
        <dt>Seats</dt><dd>{t.seats} × {fmt(each)}</dd>
        <dt>Total paid</dt><dd><strong>{fmt(each * t.seats)}</strong></dd>
        <dt>Paid with</dt><dd>PayPal{t.orderId ? ` · order ${t.orderId}` : ""}</dd>
        <dt>Reference</dt><dd>{t.holdId}</dd>
      </dl>
      <p className="receipt-foot">Online Cinema Ltd, trading as E-Cinema · RC 9947766 · Lagos, Nigeria · e-cinema.net</p>
      <PrintButton />
    </main>
  );
}
