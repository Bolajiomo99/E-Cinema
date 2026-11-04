"use client";
import Link from "next/link";
import dynamic from "next/dynamic";
import type { FilmMoney } from "@/components/PaymentsGrid";

// PayPal and AI agents (Figma 285:373). Money is from the ledger and PayPal webhooks; the payment
// watch agent runs its checks on every load. Subscriptions and Pay Later are not told apart in
// PayPal's events yet, so they show as Soon, as does the widget builder.
const PaymentsGrid = dynamic(() => import("@/components/PaymentsGrid"), { ssr: false, loading: () => <p className="exc-empty">Loading the grid…</p> });

export type PayPalView = {
  days: number; revenue: number; revenuePrev: number; orders: number; conciergeOrders: number; conciergeHolds: number;
  refunded: number; refundedPrev: number; paidPrev: number; disputesOpen: number; disputesStake: number; disputesDue48: number;
  buckets: { start: string; checkout: number; donations: number }[]; monthly: boolean;
  films: FilmMoney[]; watch: { tone: "amber" | "red" | "green"; title: string; body: string; href?: string }[];
};

const PRODUCTS = [
  { k: "checkout", label: "Checkout", color: "#e3182d" },
  { k: "subs", label: "Subscriptions", color: "#8b7cf6", soon: true },
  { k: "later", label: "Pay Later", color: "#d4a032", soon: true },
  { k: "donations", label: "Donations (18+)", color: "#2bb3a3" },
] as const;
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function money(v: number) {
  if (Math.abs(v) >= 1e6) return `$${(v / 1e6).toFixed(2).replace(/\.?0+$/, "")}M`;
  if (Math.abs(v) >= 1e4) return `$${Math.round(v / 1e3)}K`;
  return `$${Math.round(v).toLocaleString("en-US")}`;
}
const pct1 = (a: number, b: number) => (b ? (a / b) * 100 : 0);

export default function ExecPayPal({ v }: { v: PayPalView }) {
  const growth = v.revenuePrev ? Math.round(((v.revenue - v.revenuePrev) / v.revenuePrev) * 100) : null;
  const share = Math.round(pct1(v.conciergeOrders, v.orders));
  const approved = Math.round(pct1(v.conciergeOrders, v.conciergeHolds));
  const refund = pct1(v.refunded, v.orders), refundPrev = pct1(v.refundedPrev, v.paidPrev);
  const period = v.days === 30 ? "last 30 days" : v.days === 90 ? "last quarter" : "last year";
  const tiles = [
    { label: "PayPal revenue", value: money(v.revenue), sub: growth == null ? (v.revenue ? "new this period" : "No PayPal sales yet") : `${growth >= 0 ? "+" : "−"}${Math.abs(growth)}% vs the period before`, tone: growth == null || growth >= 0 ? "up" : "down" },
    { label: "Booked by concierge", value: `${share}%`, sub: `${v.conciergeOrders.toLocaleString("en-US")} of ${v.orders.toLocaleString("en-US")} orders${v.conciergeHolds ? ` · ${approved}% approved` : ""}`, tone: "blue" },
    { label: "Refund rate", value: `${refund.toFixed(1)}%`, sub: v.paidPrev ? `${refund <= refundPrev ? "Down" : "Up"} from ${refundPrev.toFixed(1)}%` : "Nothing to compare yet", tone: !v.paidPrev ? "" : refund <= refundPrev ? "up" : "down" },
    { label: "Open disputes", value: String(v.disputesOpen), sub: v.disputesOpen ? `${money(v.disputesStake)} at stake · ${v.disputesDue48} due in 48h` : "None open", tone: v.disputesOpen ? "amber" : "up" },
  ];
  const max = Math.max(1, ...v.buckets.map((b) => b.checkout + b.donations));
  const label = (s: string, i: number) => (v.monthly ? MON[Number(s.slice(5, 7)) - 1] : `W${i + 1}`);

  function exportPack() {
    const rows: (string | number)[][] = [["E-Cinema PayPal and AI agents", period, "USD at today's rate"], [], ...tiles.map((t) => [t.label, t.value, t.sub]), [], ["Period start", "Checkout USD", "Donations USD"]];
    v.buckets.forEach((b) => rows.push([b.start, b.checkout.toFixed(2), b.donations.toFixed(2)]));
    rows.push([], ["Film", "Studio", "Seats sold", "PayPal revenue USD", "Refunds %", "Disputes", "Studio payout USD"]);
    v.films.forEach((f) => rows.push([f.film, f.studio, f.seats, f.usd.toFixed(2), f.refundPct.toFixed(1), f.disputes, f.payout.toFixed(2)]));
    const csv = rows.map((r) => r.map((c) => (/[",\n]/.test(String(c)) ? `"${String(c).replace(/"/g, '""')}"` : c)).join(",")).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = `e-cinema-paypal-${v.days}d.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  return (
    <section className="exc expp">
      <header className="exc-head">
        <div>
          <h1>PayPal and AI agents</h1>
          <p className="exc-sub">Live from the ledger and PayPal webhooks · {period} · all countries in USD</p>
        </div>
        <div className="exc-chips" role="group" aria-label="Period">
          {[[30, "30 days"], [90, "Quarter"], [365, "Year"]].map(([d, t]) => <Link key={d} href={`/executive/payments?days=${d}`} className={`exm-chip${v.days === d ? " on" : ""}`} aria-current={v.days === d ? "page" : undefined}>{t}</Link>)}
          <button className="exm-export" onClick={exportPack}>Export board pack</button>
        </div>
      </header>

      <div className="expp-ask" aria-disabled="true">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="#f2b84b" aria-hidden><path d="M12 2l1.8 6.2L20 10l-6.2 1.8L12 18l-1.8-6.2L4 10l6.2-1.8z" /></svg>
        <span>Show PayPal revenue by customer segment this month</span>
        <em className="soon-tag">Soon</em>
        <button type="button" disabled>Build widget</button>
      </div>

      <div className="exc-tiles expp-tiles">
        {tiles.map((t) => <div key={t.label} className="exc-tile"><span>{t.label}</span><b>{t.value}</b><small className={t.tone}>{t.sub}</small></div>)}
      </div>

      <div className="expp-row">
        <div className="exc-card">
          <h2>Revenue by PayPal product</h2>
          <ul className="expp-key">{PRODUCTS.map((p) => <li key={p.k}><i style={{ background: p.color }} />{p.label}{"soon" in p && <small className="exsec-soon">Soon</small>}</li>)}</ul>
          {v.buckets.length ? (
            <div className="expp-bars" role="img" aria-label={`PayPal revenue by ${v.monthly ? "month" : "week"}, highest ${money(max)}`}>
              {v.buckets.map((b, i) => (
                <div key={b.start} className="expp-col" title={`${b.start}: ${money(b.checkout + b.donations)}`}>
                  <div className="expp-stack">
                    {b.donations > 0 && <i style={{ height: `${(b.donations / max) * 100}%`, background: "#2bb3a3" }} />}
                    {b.checkout > 0 && <i style={{ height: `${(b.checkout / max) * 100}%`, background: "#e3182d" }} />}
                  </div>
                  <span>{label(b.start, i)}</span>
                </div>
              ))}
            </div>
          ) : <p className="exc-empty">No PayPal money in this period.</p>}
        </div>
        <div className="exc-card">
          <h2>Payment watch agent</h2>
          <div className="expp-watch">
            {v.watch.map((w) => {
              const body = <><b>{w.title}</b><p>{w.body}</p></>;
              return w.href ? <Link key={w.title} href={w.href} className={`expp-alert ${w.tone}`}>{body}</Link> : <div key={w.title} className={`expp-alert ${w.tone}`}>{body}</div>;
            })}
          </div>
        </div>
      </div>

      <div className="exc-card">
        <h2>Revenue by film</h2>
        <PaymentsGrid rows={v.films} />
        <p className="expp-foot">Grid built with AG Grid · seats paid through PayPal only · studio payout is 70% of the ticket money</p>
      </div>
    </section>
  );
}
