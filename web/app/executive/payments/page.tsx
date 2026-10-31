import { ledger } from "@/lib/exec-demo";
import PaymentsGrid from "@/components/PaymentsGrid";

export const metadata = { title: "PayPal and agents · Executive · E-Cinema" };

const usd = (v: number) => `$${Math.round(v).toLocaleString("en-US")}`;

export default function PaymentsDashboard() {
  const gross = ledger.reduce((s, r) => s + r.grossUsd, 0);
  const tickets = ledger.reduce((s, r) => s + r.tickets, 0);
  const viaAgent = ledger.filter((r) => r.viaAgent).reduce((s, r) => s + r.grossUsd, 0);
  const disputes = ledger.reduce((s, r) => s + r.disputes, 0);
  const kpis = [
    { label: "Gross through PayPal", value: usd(gross) },
    { label: "Tickets sold", value: tickets.toLocaleString("en-US") },
    { label: "Booked by the concierge", value: `${Math.round((viaAgent / gross) * 100)}%` },
    { label: "Open disputes", value: String(disputes) },
  ];
  return (
    <section className="exec">
      <p className="eyebrow">Executive · Demo data until the ledger is live</p>
      <h1>PayPal and agents</h1>
      <div className="kpis">
        {kpis.map((k) => (
          <div key={k.label} className="kpi">
            <span>{k.label}</span>
            <strong>{k.value}</strong>
          </div>
        ))}
      </div>
      <PaymentsGrid rows={ledger} />
    </section>
  );
}
