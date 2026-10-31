import "server-only";

// "Shop the film": real products from Channel3 that match a film's look.
export type ShopItem = { id: string; title: string; brand?: string; image?: string; price: number; currency: string; url: string; store: string };

type C3Product = {
  id: string;
  title: string;
  brands?: { name: string }[];
  images?: { url: string; is_main_image?: boolean }[];
  offers?: { url: string; domain: string; availability: string; price: { price: number; currency: string } }[];
};

const cache = new Map<string, { at: number; items: ShopItem[] }>();
const TTL = 10 * 60_000;

export async function shopFor(query: string, limit = 6): Promise<ShopItem[]> {
  const hit = cache.get(query);
  if (hit && Date.now() - hit.at < TTL) return hit.items;
  const key = process.env.CHANNEL3_API_KEY;
  if (!key) throw new Error("CHANNEL3_API_KEY is not set");

  const res = await fetch("https://api.trychannel3.com/v1/search", {
    method: "POST",
    headers: { "x-api-key": key, "Content-Type": "application/json" },
    body: JSON.stringify({ query, limit: limit * 2 }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`Channel3 ${res.status}`);
  const { products } = (await res.json()) as { products: C3Product[] };

  const items = products
    .map((p): ShopItem | null => {
      const offer = p.offers?.find((o) => o.availability !== "OutOfStock" && o.url.startsWith("https://"));
      if (!offer) return null;
      const image = (p.images?.find((i) => i.is_main_image) ?? p.images?.[0])?.url;
      return { id: p.id, title: p.title, brand: p.brands?.[0]?.name, image, price: offer.price.price, currency: offer.price.currency, url: offer.url, store: offer.domain };
    })
    .filter((x): x is ShopItem => x !== null)
    .slice(0, limit);
  cache.set(query, { at: Date.now(), items });
  return items;
}
