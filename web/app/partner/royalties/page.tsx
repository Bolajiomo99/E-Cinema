import PayRoyalty from "@/components/licensing/PayRoyalty";
import { PayoutChange, StatementCsv } from "@/components/licensing/RoyaltyTools";
import { myLicence, partnerPage, session } from "@/lib/licensing";
import { dateName, invoiceNo, monthName, naira, royaltyDueBy, short, type Royalties } from "@/lib/licensing-types";

// Figma "Licensee / Royalties and payouts" (116:634).
const PILL: Record<string, [string, string]> = { open: ["amber", "Open"], due: ["red", "Due"], settled: ["teal", "Settled"] };

export default async function PartnerRoyalties({ searchParams }: { searchParams: Promise<{ pay?: string }> }) {
  const { pay } = await searchParams;
  const s = await session();
  const [mine, r] = await Promise.all([myLicence(s), partnerPage<Royalties>(s, "royalties")]);
  if (!mine || !r) return <p className="pt-empty">Royalties could not load. Refresh to try again.</p>;
  const l = mine.licensee;
  const held = l.payoutHoldUntil && new Date(l.payoutHoldUntil) > new Date();
  return (
    <div className="pt-body">
      <header className="bp-head">
        <div>
          <h1>Royalties and payouts</h1>
          <p>What you owe E‑Cinema and what E‑Cinema owes you</p>
        </div>
        <StatementCsv licence={l.licence} pct={l.plan.royaltyPct} rows={r.statements} />
      </header>
      <div className="bp-kpis">
        <div className="bp-kpi"><span>Licence fee</span><b>{l.plan.feeNgn ? "Paid" : "Agreed"}</b><em>{l.plan.name} · until {dateName(l.validUntil)}</em></div>
        <div className="bp-kpi"><span>Royalty this month</span><b>{naira(r.current.royaltyNgn)}</b><em>{l.plan.royaltyPct}% of {short(r.current.salesNgn)}</em></div>
        <div className="bp-kpi"><span>E-Cinema shop sales owed to you</span><b>{naira(r.current.shopNgn)}</b><em className={l.plan.inShop ? "" : "muted"}>{l.plan.inShop ? "paid on the 15th" : "Growth and Global plans"}</em></div>
        <div className="bp-kpi"><span>Net to you</span><b>{r.netNgn < 0 ? `−${naira(-r.netNgn)}` : naira(r.netNgn)}</b><em className={r.netNgn < 0 ? "neg" : ""}>{r.netNgn < 0 ? "royalty is more than shop sales" : "after royalty"}</em></div>
      </div>
      <section className="bp-panel">
        <h2>Statements</h2>
        {r.statements.length ? (
          <table className="pt-table wide">
            <thead><tr><th>Month</th><th>Your sales</th><th>Royalty {l.plan.royaltyPct}%</th><th>Shop sales paid to you</th><th>Status</th></tr></thead>
            <tbody>
              {r.statements.map((x) => (
                <tr key={x.month}>
                  <td className="strong">{monthName(x.month)}</td>
                  <td>{short(x.salesNgn)}</td>
                  <td>{short(x.royaltyNgn)}</td>
                  <td>{short(x.shopNgn)}</td>
                  <td>
                    <span className={`bp-pill ${PILL[x.status][0]}`}>{PILL[x.status][1]}</span>
                    {x.status === "due" && x.royaltyNgn > 0 && (
                      <> <PayRoyalty month={x.month} invoice={invoiceNo(l.licence, x.month)} royaltyNgn={x.royaltyNgn} dueBy={royaltyDueBy(x.month)} payReady={Boolean(process.env.PAYPAL_CLIENT_ID)} autoOpen={pay === x.month} /></>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <p className="pt-empty">Your first statement opens with your first sale.</p>}
      </section>
      <section className="bp-panel">
        <h2>Payout account</h2>
        <div className="pt-v">
          <div>
            <b>{l.payoutBank ? `${l.payoutBank} •••• ${l.payoutLast4}` : "No payout account yet"}</b>
            <small>{l.payoutBank ? `${l.payoutName}${l.payoutVerified ? " · verified" : " · name does not match the company"}${held ? ` · payouts held until ${dateName(l.payoutHoldUntil!)}` : ""}` : "Add the company bank account E‑Cinema pays shop sales into"}</small>
          </div>
          {l.payoutBank && <span className={`bp-pill ${held ? "amber" : l.payoutVerified ? "teal" : "amber"}`}>{held ? "On hold" : l.payoutVerified ? "Verified" : "Check name"}</span>}
        </div>
        <PayoutChange owner={l.role === "owner"} identityOk={mine.identityOk} has={Boolean(l.payoutBank)} company={l.name} />
      </section>
    </div>
  );
}
