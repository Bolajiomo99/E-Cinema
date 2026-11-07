import { cookies } from "next/headers";
import { accountApi, SESSION_COOKIE } from "@/lib/auth";
import { json, sameOrigin } from "@/lib/room-gate";

// Player heartbeats for Insights; the Go API caps each beat and ignores beats sent too fast.
export async function POST(req: Request) {
  if (!sameOrigin(req)) return json(403, { error: "forbidden" });
  const session = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!session) return json(401, { error: "Sign in first" });
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  // Player reports (position, drift, stalls, start time) ride along when the player sends them.
  const player = typeof b.device === "string"
    ? { device: b.device, position: num(b.position), driftMs: Math.round(num(b.driftMs)), stallMs: Math.round(num(b.stallMs)), stalls: Math.round(num(b.stalls)), startMs: Math.round(num(b.startMs)), hour: Math.round(num(b.hour)), dow: Math.round(num(b.dow)) }
    : {};
  const r = await accountApi("POST", "/v1/me/watch-beats", { showtimeId: b.showtimeId, mode: b.mode, audio: b.audio ?? "", subs: b.subs ?? "", seconds: b.seconds, ...player }, session);
  // Kids screen time and bedtime: the player stops when this says so.
  const p = await accountApi("POST", "/v1/me/profile/watch", { seconds: b.seconds }, session);
  const st = p.status === 200 ? (p.body as { blocked?: string; message?: string }) : {};
  return json(r.status, { ...((r.body as object) ?? {}), blocked: st.blocked ?? "", message: st.message ?? "" });
}
