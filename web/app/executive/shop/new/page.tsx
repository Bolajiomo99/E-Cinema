import { session } from "@/lib/licensing";
import { execCanAdd } from "@/lib/exec";
import { usdRates } from "@/lib/fx";
import ExecProduct from "@/components/exec/ExecProduct";

export const metadata = { title: "Add a product · Executive · E-Cinema", robots: { index: false } };

// Add a product (Figma 83:631).
export default async function NewProduct() {
  if (!(await execCanAdd(await session()))) return <section className="exc"><h1>Add a product</h1><p className="exc-sub">The CEO, and cabinet members allowed to add merch and rooms, can add products.</p></section>;
  return <ExecProduct product={null} rates={(await usdRates()) ?? {}} />;
}
