import { NextResponse } from "next/server";
import { findShowtime, shopQuery, type ShopTab } from "@/lib/catalog";
import { convert } from "@/lib/fx";
import { readLocale } from "@/lib/locale";
import { currencyFor } from "@/lib/plans";
import { shopFor } from "@/lib/shop";

const TABS: ShopTab[] = ["scene", "outfits", "gifts", "snacks"];

// GET /api/shop?showtime=<id>&tab=scene|outfits|gifts|snacks returns products inspired by that
// film, from Channel3, with each price also shown in the viewer's own currency.
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const showtime = findShowtime(q.get("showtime") ?? "");
  if (!showtime) return NextResponse.json({ error: "Unknown showtime" }, { status: 400 });
  const tab = (TABS as string[]).includes(q.get("tab") ?? "") ? (q.get("tab") as ShopTab) : "scene";
  try {
    const [items, loc] = await Promise.all([shopFor(shopQuery(showtime, tab)), readLocale().catch(() => null)]);
    const to = currencyFor(loc?.country);
    const priced = await Promise.all(items.map(async (i) => {
      const local = i.currency === to ? null : await convert(i.price, i.currency, to);
      return { ...i, local: local === null ? undefined : { price: local, currency: to } };
    }));
    return NextResponse.json({ film: showtime.film, tab, items: priced });
  } catch (err) {
    console.error("Shop error", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Shop unavailable" }, { status: 502 });
  }
}
