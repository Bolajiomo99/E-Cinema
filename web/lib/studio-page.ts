import "server-only";
import { accountApi } from "@/lib/auth";

// The public studio page (Figma 597:27), read from the Go API.
export type PageFilm = { showtimeId: string; film: string; startsAt: string; priceCents: number; rating: number; reviews: number; upload: string; poster: boolean };
export type StudioPage = {
  name: string; slug: string; city: string; country: string; website: string; bio: string; verifiedAt: string | null;
  followers: number; premieres: number; countries: number; following: boolean; coming: PageFilm[]; past: PageFilm[];
};

export async function studioPublicPage(slug: string, session?: string): Promise<StudioPage | null> {
  if (!/^[a-z0-9-]{1,90}$/.test(slug)) return null;
  const r = await accountApi("GET", `/v1/studio-pages/${slug}`, undefined, session).catch(() => null);
  return r?.status === 200 ? (r.body as StudioPage) : null;
}
