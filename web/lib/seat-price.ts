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

// quoteLabel shows a quoted total (seat plus VAT, late entry or quality) in the viewer's
// currency, scaling a studio's own local price the way checkout charges it.
export async function quoteLabel(s: Pick<Showtime, "price" | "local">, total: { currency: string; value: string }, country?: string): Promise<string> {
  const base = Number(s.price.value);
  if (!base || total.currency !== s.price.currency) return usd(total);
  const scale = Number(total.value) / base;
  const local = s.local && country && s.local[country] ? { [country]: { ...s.local[country], minor: Math.round(s.local[country].minor * scale) } } : undefined;
  return seatPriceLabel({ price: total, local }, country);
}

// centsFormatter returns a function that shows a dollar amount (in cents) in the viewer's
// currency at today's rate, for pages that work out prices themselves (pre-order stages).
export async function centsFormatter(country?: string): Promise<(currency: string, cents: number) => string> {
  const cur = currencyFor(country);
  const rate = cur === "USD" ? null : await convert(1, "USD", cur);
  return (currency, cents) => {
    if (currency !== "USD" || !rate) return usd({ currency, value: (cents / 100).toFixed(2) });
    const v = (cents / 100) * rate;
    return cur === "NGN" ? `₦${Math.ceil(v).toLocaleString("en-NG")}` : `${SYMBOL[cur]}${(Math.ceil(v * 100) / 100).toFixed(2)}`;
  };
}

// withLocalPrices adds priceLabel to each showtime for the viewer's country.
export async function withLocalPrices<T extends Pick<Showtime, "price" | "local">>(list: T[], country?: string): Promise<(T & { priceLabel: string })[]> {
  return Promise.all(list.map(async (s) => ({ ...s, priceLabel: await seatPriceLabel(s, country) })));
}
