import "server-only";
import { accountApi } from "@/lib/auth";

// The viewer's Library (Figma 19:583): replays for 30 days after a premiere, films kept for
// good, requested classics and collections. Mirrors api/internal/library.
export type LibraryItem = { showtimeId: string; film: string; quality: "hd" | "4k"; owned: boolean; expiresAt?: string; addedAt: string };
export type Requested = { id: string; title: string; year?: number; votes: number; goal: number; status: "yes" | "talks" | "blocked" | "sent"; startsAt?: string; showtimeId?: string; colors: string[]; requestedAt: string };
export type Collection = { id: string; name: string; kids: boolean; colors: string[]; films: string[]; sharedWith: string[]; mine: boolean; owner?: string; createdAt: string };
export type Library = { items: LibraryItem[]; requested: Requested[]; collections: Collection[] };

export async function myLibrary(session: string): Promise<Library> {
  const r = await accountApi("GET", "/v1/me/library", undefined, session);
  if (r.status !== 200) return { items: [], requested: [], collections: [] };
  return r.body as Library;
}

// Keeping a film: twice the seat price in HD, plus two dollars for 4K. The studio's share of
// kept films is settled separately from seat payouts.
export function keepPrice(seat: string, quality: "hd" | "4k"): string {
  const cents = Math.round(Number(seat) * 100) * 2 + (quality === "4k" ? 200 : 0);
  return (cents / 100).toFixed(2);
}
