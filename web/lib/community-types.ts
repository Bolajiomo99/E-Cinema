// Shapes from api/internal/community, shared by the Community pages.
export type Group = {
  id: string; slug: string; name: string; about: string; rules: string; visibility: "public" | "private";
  members: number; joined: boolean; role?: "owner" | "mod" | "member"; createdAt: string;
};
export type GroupParty = { code: string; name: string; film: string; startsAt: string };
export type Author = { id: string; name: string; country: string };
export type Option = { label: string; votes: number };
export type Post = {
  id: number; kind: "text" | "photo" | "poll"; body: string; lang: string; mediaKey?: string; film?: string; showtimeId?: string;
  author: Author; community?: { slug: string; name: string }; pinned: boolean; likes: number; comments: number; shares: number;
  liked: boolean; options?: Option[]; myVote?: number; pollEndsAt?: string; canModerate: boolean; createdAt: string;
};
export type Comment = { id: number; author: Author; body: string; createdAt: string; mine: boolean };
export type Person = Author & { note: string; following: boolean };
export type Tag = { tag: string; posts: number };

// 1234 -> 1.2K, 1250000 -> 1.3M
export function compact(n: number): string {
  if (n < 1000) return String(n);
  const [d, s] = n < 1e6 ? [1e3, "K"] : [1e6, "M"];
  const v = n / d;
  return `${v >= 100 ? Math.round(v) : Math.round(v * 10) / 10}${s}`;
}

export function ago(iso: string, now = Date.now()): string {
  const s = Math.max(0, Math.floor((now - Date.parse(iso)) / 1000));
  if (s < 60) return "now";
  if (s < 3600) return `${Math.floor(s / 60)} min`;
  if (s < 86400) return `${Math.floor(s / 3600)} h`;
  if (s < 7 * 86400) return `${Math.floor(s / 86400)} d`;
  return new Date(iso).toLocaleDateString([], { day: "numeric", month: "short" });
}

export function endsIn(iso: string, now = Date.now()): string {
  const s = Math.floor((Date.parse(iso) - now) / 1000);
  if (s <= 0) return "Final results";
  if (s < 3600) return `ends in ${Math.max(1, Math.floor(s / 60))} min`;
  if (s < 86400) return `ends in ${Math.floor(s / 3600)} h`;
  return `ends in ${Math.floor(s / 86400)} d`;
}

// Profile (Figma 32:1060, 95:1863, 95:2002).
export type ProfilePage = {
  id: string; name: string; country: string; username: string; city: string; interests: string; spoken: string[];
  plan: string; verified: boolean; me: boolean; following: boolean; followers: number; follows: number; posts: number;
  premieres: number; countries: number; reviews: number; showsReviews: boolean; joinedAt: string;
};
export type Watched = { showtimeId: string; film: string; startsAt: string; minutes: number; stars: number };
export type ProfileReview = { showtimeId: string; film: string; stars: number; tags: string[]; body: string; likes: number; liked: boolean; createdAt: string };
export type Badge = { key: string; name: string; about: string; letter: string; color: string; progress: number; goal: number; earned: boolean };
