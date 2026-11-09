import { session } from "@/lib/licensing";
import { execAutoFlags, execSafety, safetyVerdicts } from "@/lib/exec";
import ExecSafety from "@/components/exec/ExecSafety";

export const metadata = { title: "Safety and trust · Executive · E-Cinema", robots: { index: false } };

// Safety and trust (Figma 82:1075).
export default async function Safety() {
  const s = await session();
  const [d, auto] = await Promise.all([execSafety(s), execAutoFlags(s)]);
  if (!d) return <section className="exc"><h1>Safety and trust</h1><p className="exc-sub">This page is for the CEO and the COO.</p></section>;
  return <ExecSafety d={d} ai={await safetyVerdicts(d.queue)} auto={auto} />;
}
