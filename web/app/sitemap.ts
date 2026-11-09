import type { MetadataRoute } from "next";
import { showtimes } from "@/lib/catalog";
import { jobBoard } from "@/lib/careers";
import { SITE } from "@/lib/site";

export const revalidate = 3600;

const PUBLIC = [
  "/", "/browse", "/releases", "/coming-soon", "/classics", "/map", "/search", "/plans", "/student", "/gift", "/family", "/kids",
  "/shop", "/community", "/rewards", "/verify", "/licensing", "/licensing/apply", "/licensing/brand-guide", "/about", "/for-studios",
  "/business", "/careers", "/concierge", "/help", "/help/refund", "/refunds", "/join", "/signin", "/privacy", "/terms", "/cookies",
  "/legal/community", "/legal/kids", "/legal/studios",
];

// Every public page plus each film and open job, so search engines find premieres on their own.
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();
  const pages = PUBLIC.map((p) => ({ url: `${SITE}${p}`, lastModified: now, changeFrequency: "daily" as const, priority: p === "/" ? 1 : 0.6 }));
  const films = showtimes.filter((s) => !s.encoreOf).map((s) => ({ url: `${SITE}/film/${s.id}`, lastModified: now, changeFrequency: "hourly" as const, priority: 0.8 }));
  const jobs = (await jobBoard().catch(() => ({ jobs: [] as { slug: string }[] }))).jobs.map((j) => ({ url: `${SITE}/careers/jobs/${j.slug}`, lastModified: now, priority: 0.4 }));
  return [...pages, ...films, ...jobs];
}
