// Plan prices from Figma "Plans · Nigeria (NGN)" (18:426) and "Plans · Germany (EUR)" (28:304).
// One table for the landing page, sign-up and checkout so prices never disagree.
export type PlanId = "free" | "student" | "pro" | "vip" | "enterprise";
export type Currency = "NGN" | "EUR" | "USD";

export const PLANS: { id: PlanId; name: string; badge: string; blurb: string; per: "mo" | "seat" | "" }[] = [
  { id: "free", name: "Free", badge: "FREE", blurb: "Single tickets, 5 minutes of talk time per premiere, then muted", per: "" },
  { id: "student", name: "Student", badge: "STUDENT", blurb: "Pro features at a student price. Needs a school email", per: "mo" },
  { id: "pro", name: "Pro", badge: "PRO", blurb: "Talk freely, send voice notes and files, request classics", per: "mo" },
  { id: "vip", name: "VIP group", badge: "VIP", blurb: "5 to 50 seats together at a lower price per seat", per: "seat" },
  { id: "enterprise", name: "Enterprise", badge: "ENTERPRISE", blurb: "Watch alone or invite-only, private rooms, team billing", per: "mo" },
];

const PRICES: Record<Currency, Record<PlanId, number>> = {
  NGN: { free: 0, student: 1500, pro: 4500, vip: 2900, enterprise: 25000 },
  EUR: { free: 0, student: 2.99, pro: 7.99, vip: 4.29, enterprise: 39.99 },
  USD: { free: 0, student: 2.99, pro: 7.99, vip: 4.29, enterprise: 39.99 },
};

const EURO = new Set(["AT", "BE", "CY", "DE", "EE", "ES", "FI", "FR", "GR", "HR", "IE", "IT", "LT", "LU", "LV", "MT", "NL", "PT", "SI", "SK"]);
// Value-added tax shown at checkout, by country.
const VAT: Record<string, number> = { NG: 0.075, DE: 0.19, FR: 0.2, NL: 0.21, ES: 0.21, IT: 0.22, IE: 0.23, BE: 0.21, AT: 0.2, PT: 0.23 };

export const currencyFor = (country?: string): Currency => (country === "NG" ? "NGN" : country && EURO.has(country) ? "EUR" : "USD");
export type Cycle = "month" | "year";
export const YEARLY_SAVING = 0.2;

// VIP seats get cheaper as the group grows (Figma 18:425). One tier applies to every seat.
export const VIP_TIERS: Record<Currency, [from: number, to: number, perSeat: number][]> = {
  NGN: [[5, 9, 3200], [10, 24, 2900], [25, 50, 2500]],
  USD: [[5, 9, 4.79], [10, 24, 4.29], [25, 50, 3.79]],
  EUR: [[5, 9, 4.79], [10, 24, 4.29], [25, 50, 3.79]],
};
export const vipSeatPrice = (seats: number, currency: Currency) =>
  (VIP_TIERS[currency].find(([a, b]) => seats >= a && seats <= b) ?? VIP_TIERS[currency][1])[2];

const round = (v: number, currency: Currency) => (currency === "NGN" ? Math.round(v / 100) * 100 : Math.round(v * 100) / 100);

// Price for one billing period. Yearly is twelve months less the saving.
export function priceOf(plan: PlanId, currency: Currency, cycle: Cycle = "month") {
  const m = PRICES[currency][plan];
  return cycle === "year" ? round(m * 12 * (1 - YEARLY_SAVING), currency) : m;
}
export function vipPrice(seats: number, currency: Currency, cycle: Cycle = "month") {
  const m = vipSeatPrice(seats, currency);
  return cycle === "year" ? round(m * 12 * (1 - YEARLY_SAVING), currency) : m;
}
export const vatRate = (country?: string) => (country ? VAT[country] ?? 0 : 0);

export function money(value: number, currency: Currency) {
  return new Intl.NumberFormat(currency === "EUR" ? "de-DE" : "en-NG", {
    style: "currency",
    currency,
    maximumFractionDigits: Number.isInteger(value) ? 0 : 2,
    minimumFractionDigits: Number.isInteger(value) ? 0 : 2,
  }).format(value);
}

export function countryName(code?: string) {
  if (!code) return "";
  try {
    return new Intl.DisplayNames(["en"], { type: "region" }).of(code) ?? code;
  } catch {
    return code;
  }
}

// Payment methods offered per country (Figma "Sign up · 4 Pay", 29:521).
// "ready" means the provider is switched on for this site; the rest wait for their keys.
export function payMethods(country: string | undefined, ready: { paypal: boolean; paystack: boolean; flutterwave: boolean; crypto: boolean }) {
  const card = { id: "card", name: "Card", sub: "Mastercard, Visa · through PayPal", ready: ready.paypal };
  const paypal = { id: "paypal", name: "PayPal", sub: country === "NG" ? "PayPal balance, card or Pay Later. Billed in USD, cancel any time" : "PayPal balance, card or Pay Later. Cancel any time", ready: ready.paypal };
  const crypto = { id: "crypto", name: "Crypto", sub: "BTC, ETH, USDC", ready: ready.crypto };
  if (country === "NG")
    return [
      paypal,
      { ...card, sub: "Mastercard, Visa, Verve" , ready: ready.paystack || ready.flutterwave },
      { id: "paystack", name: "Paystack", sub: "Card, bank, USSD, transfer", ready: ready.paystack },
      { id: "flutterwave", name: "Flutterwave", sub: "Card, bank, mobile money", ready: ready.flutterwave },
      { id: "bank", name: "Bank transfer", sub: "One-time account number", ready: ready.paystack || ready.flutterwave },
      crypto,
    ];
  return [paypal, card, crypto];
}
