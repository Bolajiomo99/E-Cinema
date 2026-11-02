// Premieres and pricing (Figma 35:514): shared by the studio page and its API route.

export type PremierePrice = { country: string; currency: string; amountMinor: number; note: string; sold: number };
export type PremiereMode = "global" | "rolling" | "waves";
export type Premiere = {
  showtimeId: string | null;
  mode: PremiereMode;
  startsAt: string | null;
  seats: number;
  encores: number;
  priceCents: number;
  freeSeats: boolean;
  freePlan: boolean;
  groupDiscounts: boolean;
  studentPrice: boolean;
  classicRequests: boolean;
  downloads: boolean;
  publishedAt: string | null;
  updatedAt: string | null;
  sold: number;
  prices: PremierePrice[];
};

export type Market = { country: string; name: string; currency: string; zone: string; digits: number; symbol: string };

// Countries a studio can price in, with the currency and the time zone shown for a local start.
// Fractional digits follow ISO 4217 (yen and won have none).
export const MARKETS: Market[] = [
  ["NG", "Nigeria", "NGN", "Africa/Lagos", 2, "₦"],
  ["GH", "Ghana", "GHS", "Africa/Accra", 2, "GH₵"],
  ["KE", "Kenya", "KES", "Africa/Nairobi", 2, "KSh "],
  ["ZA", "South Africa", "ZAR", "Africa/Johannesburg", 2, "R "],
  ["EG", "Egypt", "EGP", "Africa/Cairo", 2, "E£"],
  ["MA", "Morocco", "MAD", "Africa/Casablanca", 2, "MAD "],
  ["SN", "Senegal", "XOF", "Africa/Dakar", 0, "CFA "],
  ["CM", "Cameroon", "XAF", "Africa/Douala", 0, "FCFA "],
  ["GB", "United Kingdom", "GBP", "Europe/London", 2, "£"],
  ["DE", "Germany", "EUR", "Europe/Berlin", 2, "€"],
  ["FR", "France", "EUR", "Europe/Paris", 2, "€"],
  ["ES", "Spain", "EUR", "Europe/Madrid", 2, "€"],
  ["IT", "Italy", "EUR", "Europe/Rome", 2, "€"],
  ["NL", "Netherlands", "EUR", "Europe/Amsterdam", 2, "€"],
  ["US", "United States", "USD", "America/New_York", 2, "$"],
  ["CA", "Canada", "CAD", "America/Toronto", 2, "CA$"],
  ["MX", "Mexico", "MXN", "America/Mexico_City", 2, "MX$"],
  ["BR", "Brazil", "BRL", "America/Sao_Paulo", 2, "R$ "],
  ["AR", "Argentina", "ARS", "America/Argentina/Buenos_Aires", 2, "AR$"],
  ["CO", "Colombia", "COP", "America/Bogota", 2, "COL$"],
  ["IN", "India", "INR", "Asia/Kolkata", 2, "₹"],
  ["PK", "Pakistan", "PKR", "Asia/Karachi", 2, "Rs "],
  ["BD", "Bangladesh", "BDT", "Asia/Dhaka", 2, "৳"],
  ["AE", "United Arab Emirates", "AED", "Asia/Dubai", 2, "AED "],
  ["SA", "Saudi Arabia", "SAR", "Asia/Riyadh", 2, "SAR "],
  ["TR", "Türkiye", "TRY", "Europe/Istanbul", 2, "₺"],
  ["JP", "Japan", "JPY", "Asia/Tokyo", 0, "¥"],
  ["KR", "South Korea", "KRW", "Asia/Seoul", 0, "₩"],
  ["CN", "China", "CNY", "Asia/Shanghai", 2, "CN¥"],
  ["PH", "Philippines", "PHP", "Asia/Manila", 2, "₱"],
  ["ID", "Indonesia", "IDR", "Asia/Jakarta", 2, "Rp "],
  ["SG", "Singapore", "SGD", "Asia/Singapore", 2, "S$"],
  ["AU", "Australia", "AUD", "Australia/Sydney", 2, "A$"],
].map(([country, name, currency, zone, digits, symbol]) => ({ country, name, currency, zone, digits, symbol }) as Market);

export const marketOf = (cc: string) => MARKETS.find((m) => m.country === cc);
// The countries a new film starts with: the ones in the design.
export const STARTER = ["NG", "DE", "IN", "JP", "BR", "KE"];

export function showPrice(m: Market, minor: number) {
  const v = minor / 10 ** m.digits;
  const n = new Intl.NumberFormat("en-US", { minimumFractionDigits: m.digits && !Number.isInteger(v) ? m.digits : 0, maximumFractionDigits: m.digits }).format(v);
  return m.currency === "BRL" ? `${m.symbol}${n.replace(".", ",")}` : `${m.symbol}${n}`;
}

// "R$ 24,90", "₦3,200", "€6.99" or a plain number back to the smallest unit.
export function parsePrice(m: Market, text: string): number | null {
  let t = text.replace(/[^\d.,]/g, "");
  if (m.currency === "BRL") t = t.replace(/\./g, "").replace(",", ".");
  else t = t.replace(/,/g, "");
  const v = Number(t);
  if (!t || !Number.isFinite(v) || v <= 0) return null;
  return Math.round(v * 10 ** m.digits);
}
