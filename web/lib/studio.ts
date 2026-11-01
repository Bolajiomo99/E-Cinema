import { accountApi } from "@/lib/auth";
import type { Studio, Steps } from "@/lib/studio-types";

// Server helpers for the studio portal (Figma 34:49 onwards).

export type Mine = { studio: Studio | null; steps: Steps; identityOk: boolean };

// The signed-in person's studio, if any. Null when the API could not be reached.
export async function myStudio(s: string): Promise<Mine | null> {
  if (!s) return null;
  const r = await accountApi("GET", "/v1/me/studio", undefined, s);
  if (r.status !== 200) return null;
  const b = r.body as { studio: Studio | null; steps?: Steps; identityOk?: boolean };
  return { studio: b.studio, steps: b.steps ?? { docs: false, payout: false, rights: false, terms: false }, identityOk: Boolean(b.identityOk) };
}

export async function studioPage<T>(s: string, page: string): Promise<T | null> {
  const r = await accountApi("GET", `/v1/me/studio/${page}`, undefined, s);
  return r.status === 200 ? (r.body as T) : null;
}
