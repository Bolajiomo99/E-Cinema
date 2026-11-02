import { session } from "@/lib/licensing";
import { execShop } from "@/lib/exec";
import { usdRates } from "@/lib/fx";
import ExecShop from "@/components/exec/ExecShop";

export const metadata = { title: "Shop and merch · Executive · E-Cinema", robots: { index: false } };

// Shop and merch (Figma 51:657).
export default async function Shop() {
  const d = await execShop(await session());
  if (!d) return <section className="exc"><h1>Shop and merch</h1><p className="exc-sub">This page is for the CEO, the COO and the CFO.</p></section>;
  const fx = await usdRates();
  return <ExecShop d={d} ngnPerUsd={fx?.NGN ?? 0} />;
}
