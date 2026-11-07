// Shapes the Go shop API returns (api/internal/shop), shared by pages and client components.
export type Option = { name: string; values: string[] };
export type Product = {
  id: string; name: string; sub: string; category: "gear" | "clothing" | "snacks" | "accessories" | "gift";
  priceNgn: number; blurb: string; options: Option[]; ships: "world" | "ng" | "lagos" | "digital";
  beforeShow: boolean; shipDays: number; images: string[]; stars: number; reviews: number;
};
export type Review = { name: string; stars: number; body: string; createdAt: string };
export type Line = { product: Product; variant: string; qty: number; lineNgn: number };
export type Address = { name: string; phone: string; line1: string; area: string; city: string; state: string; country: string };
export type Show = { id: string; film: string; startsAt: string };
export type Quote = {
  lines: Line[]; count: number; itemsNgn: number; discountNgn: number; bundleNgn: number; deliveryNgn: number;
  vatRate: number; vatNgn: number; totalNgn: number; plan: string; address: Address | null; nextShow?: Show;
  suggestion?: { productId: string; name: string; saveNgn: number }; problems: string[]; cod: boolean;
};
export type Item = {
  productId: string; name: string; variant: string; qty: number; unitNgn: number; images: string[];
  shipDays: number; beforeShow: boolean; showtimeId?: string; film?: string; startsAt?: string;
};
export type Rider = { name: string; phone: string; vehicle: string; plate: string; eta: string };
export type OrderStatus = "pending" | "placed" | "packed" | "out" | "delivered" | "cancelled" | "returning" | "returned";
export type Order = {
  id: string; number: string; status: OrderStatus; method: "paypal" | "cod" | "paystack" | "flutterwave" | "instalments";
  itemsNgn: number; discountNgn: number; bundleNgn: number; deliveryNgn: number; vatNgn: number; totalNgn: number;
  chargeCurrency: string; chargeCents: number; address: Address; rider?: Rider; returnReason?: string; buyer?: string;
  createdAt: string; placedAt?: string; packedAt?: string; outAt?: string; deliveredAt?: string; cancelledAt?: string; returnAt?: string; returnedAt?: string;
  items: Item[];
  plan?: Plan;
};
// Pay in 6: parts paid so far and the next charge to the saved card.
export type Plan = { parts: number; paid: number; partNgn: number; nextNgn: number; paidNgn: number; status: "waiting" | "active" | "done" | "failed" | "stopped"; nextDue?: string; lastError?: string };

// Display prices: naira converted at one rate into the viewer's currency.
export type Pricing = { currency: string; rate: number };

export function price(ngn: number, p: Pricing): string {
  const v = ngn * p.rate;
  if (p.currency === "NGN") return "₦" + Math.round(v).toLocaleString("en-NG");
  const whole = v >= 100;
  return new Intl.NumberFormat(p.currency === "EUR" ? "de-DE" : "en-US", {
    style: "currency", currency: p.currency, maximumFractionDigits: whole ? 0 : 2, minimumFractionDigits: whole ? 0 : 2,
  }).format(whole ? Math.round(v) : v);
}

export const CATEGORY: Record<Product["category"], string> = {
  gear: "Watch gear", clothing: "Clothing", snacks: "Snacks for tonight", accessories: "Accessories", gift: "Gift cards",
};

// The first value of each option, e.g. "Black · 128 GB".
export const defaultVariant = (p: Product) => p.options.map((o) => o.values[0]).join(" · ");

export const RETURN_DAYS = 14;

// Pay in 6 (Shop hero, Cart): same split as the API. Each part is the total over six rounded
// up; the last part takes what is left.
export const INSTALMENT_PARTS = 6;
export const INSTALMENT_MIN_NGN = 100_000;
export const firstPart = (totalNgn: number) => Math.ceil(totalNgn / INSTALMENT_PARTS);
