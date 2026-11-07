// Shapes the studio portal shares between the server and the browser.

export type Studio = {
  name: string; slug: string; legalName: string; regCountry: string; regNumber: string; city: string; website: string;
  status: "draft" | "submitted" | "verified" | "rejected"; reviewNote: string;
  docsKey: string; docsOk: boolean;
  payoutMethod: "paypal" | "bank"; payoutEmail: string; payoutBank: string; payoutNumber: string; payoutName: string; payoutCurrency: string;
  shareBps: number; rightsNote: string; rightsAt: string | null; termsAt: string | null; verifiedAt: string | null; createdAt: string;
  dubReview?: boolean; // new dubbed languages wait for a person's approval
  blockedCountries?: string[]; // where none of its films are sold
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
export const can = (role: Role | undefined, action: "edit" | "team" | "money" | "marketing") =>
  role === "owner" || role === "admin" || (role === "finance" && action === "money") || (role === "marketing" && action === "marketing");

// The sidebar (Figma 34:272). Pages not built yet carry "Soon" and do not link.
export const STUDIO_NAV: { label: string; href?: string; icon: string }[] = [
  { label: "Overview", href: "/studio", icon: "home" },
  { label: "Films", href: "/studio/films", icon: "film" },
  { label: "Upload", href: "/studio/upload", icon: "upload" },
  { label: "Premieres and pricing", href: "/studio/premieres", icon: "calendar" },
  { label: "AI dubbing", href: "/studio/dubs", icon: "dub" },
  { label: "Live control room", href: "/studio/control", icon: "live" },
  { label: "Analytics", href: "/studio/analytics", icon: "chart" },
  { label: "Revenue and payouts", href: "/studio/payouts", icon: "wallet" },
  { label: "Piracy protection", href: "/studio/piracy", icon: "shield" },
  { label: "Marketing", href: "/studio/marketing", icon: "megaphone" },
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

// Film uploads (Figma 35:290).
export type UploadCheck = { state: "ok" | "warn" | "soon"; text: string };
export type UploadFile = {
  id: string; kind: "master" | "stems" | "subtitles" | "trailer" | "package"; name: string; size: number; contentType: string;
  key: string; mpId: string; status: "uploading" | "uploaded" | "failed"; info: string; checks: UploadCheck[]; updatedAt: string;
};
export type Upload = {
  id: string; title: string; logline: string; genres: string; ageRating: string; castCrew: string; languages: string; posterKey: string;
  status: "draft" | "submitted"; createdAt: string; updatedAt: string; files: UploadFile[];
};

export const UPLOAD_ACCEPT = ".mov,.mp4,.m4v,.mxf,.xml,.wav,.aif,.aiff,.flac,.srt,.vtt,.ttml";
const MIB = 1024 * 1024;

// The size of each part a file is sent in. Storage allows 10,000 parts, so a 2 TB master
// uses parts of about 233 MB; small files use 16 MB parts. Server and browser agree on it.
export function partSize(size: number) {
  return Math.max(16 * MIB, Math.ceil(size / 9000 / MIB) * MIB);
}
export function partCount(size: number) {
  return Math.max(1, Math.ceil(size / partSize(size)));
}

export function bytes(n: number) {
  const u = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  while (n >= 1000 && i < u.length - 1) { n /= 1000; i++; }
  return `${n >= 100 || i === 0 ? Math.round(n) : n.toFixed(n >= 10 ? 1 : 2)} ${u[i]}`;
}

// "2 minutes ago", built by hand so server and browser agree.
export function ago(iso: string, now: number) {
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (s < 45) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} ${m === 1 ? "minute" : "minutes"} ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} ${h === 1 ? "hour" : "hours"} ago`;
  const d = Math.round(h / 24);
  return `${d} ${d === 1 ? "day" : "days"} ago`;
}

// Where a film's premiere stands (Figma 99:247 Pre-sales and Danger zone). Money is USD cents.
export type PremierePlan = {
  showtimeId: string; startsAt: string; movedFrom?: string; withdrawnAt?: string;
  seats: number; holders: number; grossCents: number; sharePct: number; week: number; refundsDue: number;
};

// The film's short reference, as in email 44 (same rule as studios.FilmCode in the API):
// two initials of the title and four digits from the upload id, e.g. FLM-OZ-2207.
export function filmCode(title: string, uploadId: string) {
  const initials = title.split(/\s+/).map((w) => [...w].find((c) => /[\p{L}\p{N}]/u.test(c)) ?? "").filter(Boolean).slice(0, 2).join("").toUpperCase() || "X";
  const n = parseInt(uploadId.replace(/-/g, "").slice(0, 8), 16) % 10000;
  return `FLM-${initials}-${String(n).padStart(4, "0")}`;
}

// The Pre-sales tab (Figma 99:247): paid seats over the last 14 UTC days and by buyer country.
export type Sales = {
  seats: number; grossCents: number;
  days: { day: string; seats: number }[];
  countries: { country: string; seats: number; grossCents: number }[];
};
