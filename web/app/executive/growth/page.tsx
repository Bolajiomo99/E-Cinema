import { session } from "@/lib/licensing";
import { execGrowth } from "@/lib/exec";
import ExecGrowth from "@/components/exec/ExecGrowth";

export const metadata = { title: "Growth and users · Executive · E-Cinema", robots: { index: false } };

// Growth and users (Figma 82:409), for every country or one.
export default async function Growth({ searchParams }: { searchParams: Promise<{ days?: string; country?: string }> }) {
  const q = await searchParams;
  const days = [7, 30, 90].includes(Number(q.days)) ? Number(q.days) : 30;
  const g = await execGrowth(await session(), days, (q.country ?? "").slice(0, 2));
  if (!g) return <section className="exc"><h1>Growth and users</h1><p className="exc-sub">This page is for the CEO, the CFO, the COO and the CMO.</p></section>;
  return <ExecGrowth g={g} />;
}
