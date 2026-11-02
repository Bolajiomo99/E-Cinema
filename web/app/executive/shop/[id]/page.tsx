import { notFound } from "next/navigation";
import { session } from "@/lib/licensing";
import { execCanAdd, execShop } from "@/lib/exec";
import { usdRates } from "@/lib/fx";
import ExecProduct from "@/components/exec/ExecProduct";

export const metadata = { title: "Edit product · Executive · E-Cinema", robots: { index: false } };

export default async function EditProduct({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await session();
  if (!(await execCanAdd(s))) return <section className="exc"><h1>Edit product</h1><p className="exc-sub">The CEO, and cabinet members allowed to add merch and rooms, can edit products.</p></section>;
  const shop = await execShop(s);
  const p = shop?.products.find((x) => x.id === id && !x.licence);
  if (!p) notFound();
  return <ExecProduct product={p} rates={(await usdRates()) ?? {}} />;
}
