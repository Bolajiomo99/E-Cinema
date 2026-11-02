import { session } from "@/lib/licensing";
import { execLicensing } from "@/lib/exec";
import ExecLicensing from "@/components/exec/ExecLicensing";

export const metadata = { title: "Licensing · Executive · E-Cinema", robots: { index: false } };

// Licensing (Figma 117:1481).
export default async function LicensingPage() {
  const d = await execLicensing(await session());
  if (!d) return <section className="exc"><h1>Licensing</h1><p className="exc-sub">This page is for the CEO, the CMO and the CFO.</p></section>;
  return <ExecLicensing d={d} />;
}
