import { session } from "@/lib/licensing";
import { execHiring } from "@/lib/exec";
import { countryOptions } from "@/lib/countries";
import ExecHiring from "@/components/exec/ExecHiring";

export const metadata = { title: "Hiring and jobs · Executive · E-Cinema", robots: { index: false } };

// Hiring and jobs (Figma 117:948).
export default async function Hiring() {
  const d = await execHiring(await session());
  if (!d) return <section className="exc"><h1>Hiring and jobs</h1><p className="exc-sub">This page is for the CEO and the COO.</p></section>;
  return <ExecHiring d={d} countries={countryOptions()} />;
}
