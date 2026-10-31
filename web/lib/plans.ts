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
  NGN: { free: 0, student: 1500, pro: 4500, vip: 2500, enterprise: 25000 },
  EUR: { free: 0, student: 2.99, pro: 7.99, vip: 4.29, enterprise: 39.99 },
  USD: { free: 0, student: 2.99, pro: 7.99, vip: 4.29, enterprise: 39.99 },
};

const EURO = new Set(["AT", "BE", "CY", "DE", "EE", "ES", "FI", "FR", "GR", "HR", "IE", "IT", "LT", "LU", "LV", "MT", "NL", "PT", "SI", "SK"]);
// Value-added tax shown at checkout, by country.
const VAT: Record<string, number> = { NG: 0.075, DE: 0.19, FR: 0.2, NL: 0.21, ES: 0.21, IT: 0.22, IE: 0.23, BE: 0.21, AT: 0.2, PT: 0.23 };

export const currencyFor = (country?: string): Currency => (country === "NG" ? "NGN" : country && EURO.has(country) ? "EUR" : "USD");
export const priceOf = (plan: PlanId, currency: Currency) => PRICES[currency][plan];
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
  const card = { id: "card", name: "Card", sub: "Mastercard, Visa, Verve · through PayPal", ready: ready.paypal };
  const paypal = { id: "paypal", name: "PayPal", sub: "Pay with your PayPal balance or card", ready: ready.paypal };
  const crypto = { id: "crypto", name: "Crypto", sub: "BTC, ETH, USDC", ready: ready.crypto };
  if (country === "NG")
    return [
      { ...card, sub: "Mastercard, Visa, Verve" , ready: ready.paystack || ready.flutterwave },
      { id: "paystack", name: "Paystack", sub: "Card, bank, USSD, transfer", ready: ready.paystack },
      { id: "flutterwave", name: "Flutterwave", sub: "Card, bank, mobile money", ready: ready.flutterwave },
      { id: "bank", name: "Bank transfer", sub: "One-time account number", ready: ready.paystack || ready.flutterwave },
      crypto,
    ];
  return [card, paypal, crypto];
}
