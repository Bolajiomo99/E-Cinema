// Family profiles (Figma 89:1020), shared by server pages and client components.
export type MaxRating = "all" | "7" | "12" | "16" | "18";

export type Member = {
  id: string; // "owner" for the account holder
  name: string;
  kind: "owner" | "adult" | "kids";
  age?: number;
  maxRating: MaxRating;
  chat: boolean;
  askToBuy: boolean;
  screenMinutes: number; // 0 = no daily limit
  bedtime: string; // "" or HH:MM, Lagos time
  aiFilter: boolean;
  watchedToday: number; // seconds
};

export type KidsRequest = { id: string; profileId: string; profile: string; what: string; link: string; status: "pending" | "approved" | "declined"; createdAt: string };

export type Family = { profiles: Member[]; pinSet: boolean; requests: KidsRequest[]; ownerName: string; adult: boolean };

export type ActiveStatus = { profile: Member; blocked?: "bedtime" | "screen-time"; message?: string };

const ratingAge: Record<string, number> = { G: 0, U: 0, "ALL AGES": 0, "7+": 7, PG: 7, "PG-13": 12, "12A": 12, "12": 12, "13+": 12, "15": 16, "16+": 16, "16": 16, R: 16, "18+": 18, "18": 18 };
const maxAge: Record<MaxRating, number> = { all: 0, "7": 7, "12": 12, "16": 16, "18": 18 };

// Mirrors accounts.Allowed in the Go API: unknown ratings count as adult.
export function allowed(rating: string | undefined, max: MaxRating): boolean {
  const age = ratingAge[(rating ?? "").split(" (")[0].trim().toUpperCase()] ?? 18;
  return age <= maxAge[max];
}

export const ratingLabel: Record<MaxRating, string> = { all: "All ages", "7": "7+", "12": "12+", "16": "16+", "18": "18+" };

// "Bolaji Jimoh" -> BJ, "Ada" -> AD (Figma 89:1020 avatars).
export const initials = (name: string) => {
  const w = name.trim().split(/\s+/).filter(Boolean);
  return ((w.length > 1 ? w[0][0] + w[1][0] : (w[0] ?? "?").slice(0, 2)) || "?").toUpperCase();
};

const kidColors = ["#2bb3a3", "#f5b841", "#4696ff", "#e86a9a"];
// Owner red, adults violet, kids teal then amber and on, as in the Figma frame.
export const avatarColor = (m: Member, i: number, all?: Member[]) => {
  if (m.kind === "owner") return "#b5101f";
  if (m.kind === "adult") return "#8b7cf6";
  const k = all ? all.filter((x) => x.kind === "kids").findIndex((x) => x.id === m.id) : i;
  return kidColors[Math.max(0, k) % kidColors.length];
};
