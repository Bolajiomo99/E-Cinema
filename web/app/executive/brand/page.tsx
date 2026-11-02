import { session } from "@/lib/licensing";
import { execBrand } from "@/lib/exec";
import ExecBrand from "@/components/exec/ExecBrand";

export const metadata = { title: "Brand protection · Executive · E-Cinema", robots: { index: false } };

// Brand protection (Figma 117:1216).
export default async function BrandPage() {
  const d = await execBrand(await session());
  if (!d) return <section className="exc"><h1>Brand protection</h1><p className="exc-sub">This page is for the CEO and the CMO.</p></section>;
  return <ExecBrand d={d} />;
}
