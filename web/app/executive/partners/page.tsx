import { session } from "@/lib/licensing";
import { execPartner } from "@/lib/exec";
import ExecPartner from "@/components/exec/ExecPartner";

export const metadata = { title: "Partners view · Executive · E-Cinema", robots: { index: false } };
export const dynamic = "force-dynamic";

// Partners view (Figma 51:198). The CEO can pick a partner (?as=) to set up their deal and see their view.
export default async function PartnersPage({ searchParams }: { searchParams: Promise<{ as?: string }> }) {
  const as = (await searchParams).as ?? "";
  const d = await execPartner(await session(), as);
  if (!d) return <section className="exc"><h1>Your partnership with E-Cinema</h1><p className="exc-sub">This page is for E-Cinema partners and the CEO.</p></section>;
  return <ExecPartner d={d} as={as} />;
}
