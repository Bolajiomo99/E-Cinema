import ProductsApp from "@/components/licensing/ProductsApp";
import { myLicence, session, withPictures } from "@/lib/licensing";
import { accountApi } from "@/lib/auth";
import type { Product } from "@/lib/licensing-types";
import { showtimes } from "@/lib/catalog";

// Figma "Licensee / Products and approvals" (116:300).
export default async function PartnerProducts({ searchParams }: { searchParams: Promise<{ new?: string }> }) {
  const s = await session();
  const [mine, sp] = await Promise.all([myLicence(s), searchParams]);
  const r = await accountApi("GET", "/v1/me/partner/products", undefined, s);
  const products = await withPictures(r.status === 200 ? (r.body as { products: Product[] }).products : []);
  const films = [...new Set(showtimes.map((x) => x.film))].sort();
  return <ProductsApp initial={products} licensee={mine!.licensee} films={films} startNew={sp.new === "1"} />;
}
