import { session } from "@/lib/licensing";
import { json } from "@/lib/room-gate";
import { execLive } from "@/lib/exec";

// GET: the live operations numbers, polled by the page every few seconds.
export const dynamic = "force-dynamic";

export async function GET() {
  const s = await session();
  if (!s) return json(401, { error: "Sign in first" });
  const d = await execLive(s);
  return d ? json(200, d) : json(403, { error: "Executives only" });
}
