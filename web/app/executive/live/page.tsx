import { session } from "@/lib/licensing";
import { execLive } from "@/lib/exec";
import ExecLive from "@/components/exec/ExecLive";
import { uptime } from "@/lib/uptime";

export const metadata = { title: "Live operations · Executive · E-Cinema", robots: { index: false } };

// Live operations (Figma 82:852).
export default async function Live() {
  const d = await execLive(await session());
  if (!d) return <section className="exc"><h1>Live operations</h1><p className="exc-sub">This page is for the CEO, the COO and the CTO.</p></section>;
  return <ExecLive initial={d} up={await uptime()} />;
}
