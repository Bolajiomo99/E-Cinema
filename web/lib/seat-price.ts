import "server-only";
import { convert } from "@/lib/fx";
import { currencyFor } from "@/lib/plans";
import type { Showtime } from "@/lib/catalog";

// Seat prices in the viewer's own currency (Figma shows ₦ to a viewer in Nigeria). A studio's
// own price for the country wins; otherwise today's rate converts the dollar price, rounded the
// way checkout charges it (whole naira up). Without a rate the dollar price stays.
const SYMBOL: Record<string, string> = { NGN: "₦", EUR: "€", USD: "$" };

export function usd(p: { currency: string; value: string }) {
  return p.currency === "USD" ? `$${p.value}` : `${p.currency} ${p.value}`;
}

export async function seatPriceLabel(s: Pick<Showtime, "price" | "local">, country?: string): Promise<string> {
  const cur = currencyFor(country);
  if (cur === "USD" || s.price.currency !== "USD") return usd(s.price);
  const own = country ? s.local?.[country] : undefined;
  let amount = own && own.currency === cur ? own.minor / 100 : await convert(Number(s.price.value), "USD", cur);
  if (!amount) return usd(s.price);
  if (cur === "NGN") return `₦${Math.ceil(amount).toLocaleString("en-NG")}`;
  amount = Math.ceil(amount * 100) / 100;
  return `${SYMBOL[cur]}${amount.toFixed(2)}`;
}

// withLocalPrices adds priceLabel to each showtime for the viewer's country.
export async function withLocalPrices<T extends Pick<Showtime, "price" | "local">>(list: T[], country?: string): Promise<(T & { priceLabel: string })[]> {
  return Promise.all(list.map(async (s) => ({ ...s, priceLabel: await seatPriceLabel(s, country) })));
}
