import { session } from "@/lib/licensing";
import { execRecipients } from "@/lib/exec";
import { usdRates } from "@/lib/fx";
import ExecRecipients from "@/components/exec/ExecRecipients";

export const metadata = { title: "18+ recipients · Executive · E-Cinema", robots: { index: false } };
export const dynamic = "force-dynamic";

// 18+ recipients (Figma 49:1577): the charities, pastors and clerics viewers can send their first
// three 18+ unlock payments to. Amounts in US dollars at today's rate.
export default async function RecipientsPage() {
  const [d, fx] = await Promise.all([execRecipients(await session()), usdRates()]);
  if (!d) return <section className="exc"><h1>18+ recipients</h1><p className="exc-sub">Only the CEO can open this page.</p></section>;
  const usd = (xs: { currency: string; minor: number }[]) =>
    xs.reduce((s, x) => s + (x.currency === "USD" ? x.minor : fx?.[x.currency] ? Math.round(x.minor / fx[x.currency]) : 0), 0);
  return (
    <ExecRecipients
      d={d}
      paid={{ charity: usd(d.paid30.charity ?? []), pastor: usd(d.paid30.church ?? []), cleric: usd(d.paid30.mosque ?? []), access: usd(d.access30) }}
      received={Object.fromEntries(d.recipients.map((r) => [r.id, r.received30.length ? usd(r.received30) : -1]))}
    />
  );
}
