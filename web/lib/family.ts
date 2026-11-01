import "server-only";
import { cookies } from "next/headers";
import { accountApi, SESSION_COOKIE } from "@/lib/auth";
import type { ActiveStatus, Family } from "@/lib/family-types";

// Server-side reads for family pages and for checks before buying or watching.
export async function familyFor(): Promise<{ family: Family; active: ActiveStatus } | null> {
  const session = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!session) return null;
  const r = await accountApi("GET", "/v1/me/family", undefined, session);
  return r.status === 200 ? (r.body as { family: Family; active: ActiveStatus }) : null;
}

export async function activeProfile(session?: string): Promise<ActiveStatus | null> {
  const s = session ?? (await cookies()).get(SESSION_COOKIE)?.value;
  if (!s) return null;
  const r = await accountApi("GET", "/v1/me/profile/active", undefined, s);
  return r.status === 200 ? (r.body as ActiveStatus) : null;
}

// For purchase routes: a kids profile with "ask before buying" cannot pay; it sends a request instead.
export async function kidsMustAsk(session: string): Promise<boolean> {
  const a = await activeProfile(session);
  return Boolean(a && a.profile.kind === "kids" && a.profile.askToBuy);
}

// Purchase gate for kids profiles: films above their rating are refused, and with "ask before
// buying" on, payment is refused with askParent so the page can send a request instead.
export async function kidsGate(session: string | undefined, rating?: string): Promise<Response | null> {
  if (!session) return null;
  const a = await activeProfile(session);
  if (!a || a.profile.kind !== "kids") return null;
  const { allowed } = await import("@/lib/family-types");
  if (rating !== undefined && !allowed(rating, a.profile.maxRating)) return Response.json({ error: `This film is not for ${a.profile.name}'s age.` }, { status: 403 });
  if (a.profile.askToBuy) return Response.json({ error: "Ask a parent to buy this.", askParent: true }, { status: 403 });
  return null;
}
