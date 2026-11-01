import { cookies } from "next/headers";
import { accountApi, SESSION_COOKIE } from "@/lib/auth";
import { showtimes } from "@/lib/catalog";
import { aiNotes, insightsAiEnabled, myInsights, type Range } from "@/lib/insights";
import { json } from "@/lib/room-gate";

// "E-Cinema AI noticed" for Pro, VIP and Enterprise members (Figma 19:462).
export const dynamic = "force-dynamic";
const PAID = new Set(["pro", "vip", "enterprise"]);
const cache = new Map<string, { at: number; notes: unknown }>();

export async function GET(req: Request) {
  const session = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!session) return json(401, { error: "Sign in first" });
  const prof = await accountApi("GET", "/v1/me/profile", undefined, session);
  if (prof.status !== 200) return json(prof.status, prof.body);
  const p = prof.body as { id?: string; plan?: string; planStatus?: string };
  if (!PAID.has(p.plan ?? "free") || p.planStatus !== "active") return json(402, { error: "AI insights come with Pro" });
  if (!insightsAiEnabled()) return json(503, { error: "AI insights are paused for a moment" });
  const range = (new URL(req.url).searchParams.get("range") ?? "month") as Range;
  const key = `${session.slice(-16)}:${range}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < 30 * 60_000) return json(200, { notes: hit.notes });
  const rep = await myInsights(session, ["month", "6m", "all"].includes(range) ? range : "month");
  if (!rep) return json(502, { error: "Could not load your numbers" });
  const now = Date.now();
  const upcoming = showtimes.filter((s) => Date.parse(s.startsAt) > now && !s.adult).map((s) => ({ film: s.film, genres: s.genres ?? [], startsAt: s.startsAt }));
  try {
    const notes = await aiNotes(rep, upcoming, p.plan ?? "free");
    cache.set(key, { at: Date.now(), notes });
    if (cache.size > 2000) cache.delete(cache.keys().next().value!);
    return json(200, { notes });
  } catch (e) {
    console.error("insights ai", e instanceof Error ? e.message : e);
    return json(503, { error: "AI insights are paused for a moment" });
  }
}
