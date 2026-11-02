import { session } from "@/lib/licensing";
import { execSecurity } from "@/lib/exec";
import ExecSecurity from "@/components/exec/ExecSecurity";

export const metadata = { title: "Security operations · Executive · E-Cinema", robots: { index: false } };

// Security operations (Figma 117:1773).
export default async function SecurityPage() {
  const d = await execSecurity(await session());
  if (!d) return <section className="exc"><h1>Security operations</h1><p className="exc-sub">This page is for the CEO and the CTO.</p></section>;
  return <ExecSecurity d={d} />;
}
