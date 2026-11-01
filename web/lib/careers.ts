import "server-only";
import { accountApi } from "@/lib/auth";
import type { Board, Job } from "@/lib/careers-types";

export async function jobBoard(q: Record<string, string | undefined> = {}): Promise<Board> {
  const qs = new URLSearchParams(Object.entries(q).filter((e): e is [string, string] => Boolean(e[1]))).toString();
  const r = await accountApi("GET", `/v1/jobs${qs ? `?${qs}` : ""}`).catch(() => ({ status: 0, body: null }));
  return r.status === 200 ? (r.body as Board) : { jobs: [], total: 0, nigeria: 0, world: 0, ngShare: 40, teams: [], kinds: {} };
}

export async function job(slug: string): Promise<Job | null> {
  if (!/^[a-z0-9-]{3,80}$/.test(slug)) return null;
  const r = await accountApi("GET", `/v1/jobs/${slug}`);
  return r.status === 200 ? (r.body as Job) : null;
}
