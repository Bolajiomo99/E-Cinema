// Shapes the studio portal shares between the server and the browser.

export type Studio = {
  name: string; slug: string; legalName: string; regCountry: string; regNumber: string; city: string; website: string;
  status: "draft" | "submitted" | "verified" | "rejected"; reviewNote: string;
  docsKey: string; docsOk: boolean;
  payoutMethod: "paypal" | "bank"; payoutEmail: string; payoutBank: string; payoutNumber: string; payoutName: string; payoutCurrency: string;
  shareBps: number; rightsNote: string; rightsAt: string | null; termsAt: string | null; verifiedAt: string | null; createdAt: string;
  role?: Role; owner?: string;
};
export type Steps = { docs: boolean; payout: boolean; rights: boolean; terms: boolean };
export type Role = "owner" | "admin" | "finance" | "marketing" | "viewer";

export type Film = {
  showtimeId: string; film: string; startsAt: string; durationMin: number; capacity: number; seats: number;
  grossCents: number; shareCents: number; currency: string; rating: number; reviews: number; countries: number; completion: number;
  state: "upcoming" | "live" | "ended"; payout: string;
};
export type Overview = {
  studio: Studio; currency: string; earnedMonth: number; earnedLast: number; seatsMonth: number; seatsLast: number;
  countries: number; newCountries: number; completion: number; rating: number; reviews: number;
  months: { month: string; grossCents: number }[]; coming: Film[]; live: Film | null;
  owedCents: number; paidCents: number; platformCents: number; topCountries: { key: string; seats: number }[];
  notes: { kind: string; text: string }[];
};
export type PayoutRow = {
  showtimeId: string; film: string; startsAt: string; seats: number; grossCents: number; studioCents: number;
  currency: string; status: string; batchId: string; updatedAt: string;
};
export type Member = { email: string; name: string; role: Role; joined: boolean; addedAt: string; me: boolean };

export const ROLE_NAMES: Record<Role, string> = { owner: "Owner", admin: "Admin", finance: "Finance", marketing: "Marketing", viewer: "Viewer" };
export const ROLE_HELP: Record<Role, string> = {
  owner: "Everything, including the team and payout account",
  admin: "Everything the owner can do, except handing over ownership",
  finance: "Revenue, statements and the payout account",
  marketing: "Sees films, audience and numbers for campaigns",
  viewer: "Can look at everything, change nothing",
};
// Same rule as the API (api/internal/studios can()).
export const can = (role: Role | undefined, action: "edit" | "team" | "money") =>
  role === "owner" || role === "admin" || (role === "finance" && action === "money");

// The sidebar (Figma 34:272). Pages not built yet carry "Soon" and do not link.
export const STUDIO_NAV: { label: string; href?: string; icon: string }[] = [
  { label: "Overview", href: "/studio", icon: "home" },
  { label: "Films", href: "/studio/films", icon: "film" },
  { label: "Upload", icon: "upload" },
  { label: "Premieres and pricing", icon: "calendar" },
  { label: "AI dubbing", icon: "dub" },
  { label: "Live control room", icon: "live" },
  { label: "Analytics", icon: "chart" },
  { label: "Revenue and payouts", href: "/studio/payouts", icon: "wallet" },
  { label: "Piracy protection", icon: "shield" },
  { label: "Marketing", icon: "megaphone" },
  { label: "Team", href: "/studio/team", icon: "team" },
  { label: "Settings", href: "/studio/settings", icon: "gear" },
];

export function money(cents: number, currency = "USD", compact = false) {
  const v = cents / 100;
  if (compact && Math.abs(v) >= 10000) return new Intl.NumberFormat("en-US", { style: "currency", currency, notation: "compact", maximumFractionDigits: 1 }).format(v);
  const whole = Number.isInteger(v);
  return new Intl.NumberFormat("en-US", { style: "currency", currency, minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: whole ? 0 : 2 }).format(v);
}

export function change(now: number, before: number, unit = "%") {
  if (!before) return now ? { text: "new this month", up: true } : { text: "nothing yet", up: true };
  const p = Math.round(((now - before) / before) * 100);
  return { text: `${p >= 0 ? "▲" : "▼"} ${Math.abs(p)}${unit} vs last month`, up: p >= 0 };
}

export const when = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Africa/Lagos" });
// Hand-built dates, so the server and every browser print the same text (Lagos is UTC+1).
export const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const monthLabel = (m: string) => MONTHS[Number(m.slice(5, 7)) - 1] ?? m;
export function dayName(iso: string) {
  const d = new Date(Date.parse(iso) + 3600_000);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}
