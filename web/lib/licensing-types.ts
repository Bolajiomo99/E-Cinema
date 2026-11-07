// Licensed merch partners: types shared by the pages and the browser
// (Figma 114:1933 and the Licensee frames 116:38 to 116:726).
export type Plan = { id: "starter" | "growth" | "global"; name: string; feeNgn: number; royaltyPct: number; maxCountries: number; maxProducts: number; inShop: boolean };

export const PLANS: Plan[] = [
  { id: "starter", name: "Starter", feeNgn: 250000, royaltyPct: 8, maxCountries: 1, maxProducts: 5, inShop: false },
  { id: "growth", name: "Growth", feeNgn: 1200000, royaltyPct: 6, maxCountries: 3, maxProducts: 30, inShop: true },
  { id: "global", name: "Global", feeNgn: 0, royaltyPct: 5, maxCountries: 0, maxProducts: 0, inShop: true },
];
export const PLAN_LINE: Record<Plan["id"], string> = {
  starter: "1 country · up to 5 products · QR labels included",
  growth: "3 countries · 30 products · shop listing on E‑Cinema",
  global: "Any country · unlimited products · co-branded drops",
};

export type Application = {
  id: string;
  plan: Plan["id"];
  company: string;
  regNumber: string;
  country: string;
  city: string;
  website: string;
  countries: string[];
  products: string;
  docKey: string;
  docNote: string;
  docOk: boolean;
  photos: string[];
  status: "draft" | "submitted" | "approved" | "rejected" | "active";
  reviewNote: string;
  feeNgn: number;
  paidAt?: string;
  licence?: string;
  createdAt: string;
  applicant?: string;
};

export type Licensee = {
  licence: string;
  name: string;
  city: string;
  country: string;
  website: string;
  status: string;
  plan: Plan;
  countries: string[];
  validFrom: string;
  validUntil: string;
  payoutBank: string;
  payoutLast4: string;
  payoutName: string;
  payoutVerified: boolean;
  payoutHoldUntil?: string;
  role: "owner" | "staff";
};

export type Check = { name: string; detail: string; result: "pass" | "fail" | "needed" };
export type Product = {
  id: string; name: string; detail: string; priceNgn: number; film: string; imageKey: string; sampleKey: string; checks: Check[];
  status: "review" | "live" | "changes" | "rejected"; note: string; createdAt: string; liveAt?: string; sold: number; licence?: string; partner?: string;
  image?: string; sample?: string;
};
export type Share = { name: string; value: number; pct: number; country?: string };
export type Overview = {
  salesNgn: number; salesPrevNgn: number; items: number; itemsPrev: number; scans: number; scannedPct: number; royaltyNgn: number; royaltyDue: string;
  daily: { day: string; sales: number }[]; channels: Share[]; top: { id: string; name: string; sold: number; priceNgn: number; tag: string }[];
  alerts: { kind: "action" | "new" | "info"; title: string; detail: string; link: string }[];
};
export type Analytics = {
  avgOrderNgn: number; avgOrderPrev: number; repeatPct: number; premiereLift: number; returnsPct: number;
  byCountry: Share[]; byCity: Share[]; cityCountry: string; premiereHours: number[]; byFilm: Share[]; orders: number; countries: string[]; products: string[];
};
export type Codes = {
  issued: number; onSold: number; genuine: number; suspicious: number; takenDown: number; places: Share[];
  list: { code: string; scans: number; cities: string[]; ours: boolean }[];
  batches: { batch: string; product: string; count: number; scanned: number; createdAt: string }[];
};
export type Statement = { month: string; salesNgn: number; royaltyNgn: number; shopNgn: number; status: "open" | "due" | "settled" };
export type Royalties = { statements: Statement[]; current: Statement; netNgn: number };
export type Compliance = { score: number; samplesOnTime: number; samplesTotal: number; marketChecks: number; unapproved: number; royaltiesOk: number; royaltiesTotal: number; rejected: number };
export type Member = { email: string; name: string; role: "owner" | "staff"; joined: boolean; addedAt: string };

export const naira = (n: number) => `₦${Math.round(n).toLocaleString("en-NG")}`;
// ₦48.6M, ₦2.9M, ₦13,400
export function short(n: number) {
  if (Math.abs(n) >= 1e9) return `₦${(n / 1e9).toFixed(1)}B`;
  if (Math.abs(n) >= 1e6) return `₦${(n / 1e6).toFixed(1)}M`;
  return naira(n);
}
// A compliance case the brand team opened after a market check (email 43, Figma 127:435).
export type Case = {
  id: number; number: string; licence: string; company?: string; issue: string; place: string; finding: string;
  fixBy: string; status: "open" | "fixed" | "closed" | "suspended"; partnerNote: string; createdAt: string; resolvedAt?: string;
};

// Royalty invoices (email 41): licence NG-0042, October 2026 → INV-0042-10, due by the 5th of the next month.
export const invoiceNo = (licence: string, ym: string) => `INV-${licence.split("-").pop()}-${ym.slice(5, 7)}`;
export function royaltyDueBy(ym: string) {
  const d = new Date(`${ym}-01T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + 1, 5);
  return d.toISOString().slice(0, 10);
}
export const monthName = (ym: string) => new Date(`${ym}-01T00:00:00Z`).toLocaleDateString("en-GB", { month: "short", year: "numeric", timeZone: "UTC" });
export const dateName = (iso: string) => new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

export const PARTNER_NAV: [string, string][] = [
  ["Overview", "/partner"],
  ["Products and approvals", "/partner/products"],
  ["Sales analytics", "/partner/analytics"],
  ["Authenticity codes", "/partner/codes"],
  ["Royalties and payouts", "/partner/royalties"],
  ["Licence and compliance", "/partner/licence"],
  ["Team", "/partner/team"],
  ["Settings", "/partner/settings"],
];
