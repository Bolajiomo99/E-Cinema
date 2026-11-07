import { session } from "@/lib/licensing";
import { execInfra } from "@/lib/exec";
import ExecInfra from "@/components/exec/ExecInfra";
import { uptime } from "@/lib/uptime";

export const metadata = { title: "Infrastructure · Executive · E-Cinema", robots: { index: false } };
export const dynamic = "force-dynamic";

// Infrastructure (Figma 50:469).
function nowMs() {
  return Date.now();
}

export default async function InfraPage() {
  const d = await execInfra(await session());
  if (!d) return <section className="exc"><h1>Infrastructure</h1><p className="exc-sub">This page is for the CEO and the CTO.</p></section>;
  return <ExecInfra d={d} now={nowMs()} up={await uptime()} />;
}
