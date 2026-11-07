import { createHash } from "node:crypto";
import { cookies } from "next/headers";
import { accountApi, authEnabled, SESSION_COOKIE } from "@/lib/auth";

// Film page visits and trailer clip plays for the studio ticket funnel (Figma 39:678).
// The API only ever sees a salted hash of the session, or of address + browser for people
// not signed in, so a visit cannot be traced back to a person. Crawlers are not counted.
const BOT = /bot|crawl|spider|slurp|preview|facebookexternalhit|headless|lighthouse/i;
const SALT = process.env.INTERNAL_API_TOKEN ?? "";

export async function recordView(req: Request, showtimeId: string, kind: "page" | "clip"): Promise<void> {
  if (!authEnabled) return;
  const ua = req.headers.get("user-agent") ?? "";
  if (!ua || BOT.test(ua)) return;
  const session = (await cookies()).get(SESSION_COOKIE)?.value;
  const ip = req.headers.get("cf-connecting-ip") ?? req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "";
  const who = session ? `s:${session}` : `a:${ip}|${ua}`;
  const visitor = createHash("sha256").update(`${SALT}|${who}`).digest("hex").slice(0, 32);
  const country = (req.headers.get("cf-ipcountry") ?? "").toUpperCase();
  await accountApi("POST", "/v1/views", { showtimeId, kind, visitor, country }).catch(() => null);
}
