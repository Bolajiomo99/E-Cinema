import "server-only";

// Uptime from UptimeRobot (read-only key UPTIMEROBOT_API_KEY). The account also watches other
// sites, so only E-Cinema's own monitors count: the API health check and the web checkout.
// Numbers are the worst of the two, so the gauge never looks better than the weaker one.

import type { Uptime } from "@/lib/uptime-types";
export type { Uptime, UptimeIncident } from "@/lib/uptime-types";

const MONITORS = (process.env.UPTIMEROBOT_MONITORS || "804495372-804495373").trim();
let cache: { at: number; v: Uptime | null } | null = null;

type Log = { type: number; datetime: number; duration: number; reason?: { detail?: string } };
type Monitor = { friendly_name: string; status: number; custom_uptime_ratio?: string; logs?: Log[] };

export async function uptime(): Promise<Uptime | null> {
  const key = process.env.UPTIMEROBOT_API_KEY;
  if (!key) return null;
  if (cache && Date.now() - cache.at < 5 * 60_000) return cache.v;
  let v: Uptime | null = null;
  try {
    const r = await fetch("https://api.uptimerobot.com/v2/getMonitors", {
      method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, cache: "no-store", signal: AbortSignal.timeout(6000),
      body: new URLSearchParams({ api_key: key, format: "json", monitors: MONITORS, custom_uptime_ratios: "1-30-90", logs: "1", logs_limit: "20" }),
    });
    const b = (await r.json()) as { stat?: string; monitors?: Monitor[] };
    const ms = b.stat === "ok" ? b.monitors ?? [] : [];
    if (ms.length) {
      const ratio = (i: number) => Math.min(...ms.map((m) => Number((m.custom_uptime_ratio ?? "").split("-")[i]) || 0));
      const incidents = ms
        .flatMap((m) => (m.logs ?? []).filter((l) => l.type === 1).map((l, i) => ({
          monitor: m.friendly_name.replace(/^E-Cinema\s*/i, ""), at: new Date(l.datetime * 1000).toISOString(),
          minutes: Math.max(1, Math.round(l.duration / 60)), reason: l.reason?.detail ?? "", open: i === 0 && (m.status === 8 || m.status === 9),
        })))
        .sort((a, b) => b.at.localeCompare(a.at)).slice(0, 8);
      v = { day: ratio(0), month: ratio(1), quarter: ratio(2), up: ms.every((m) => m.status === 2), monitors: ms.length, incidents };
    }
  } catch {
    v = cache?.v ?? null;
  }
  cache = { at: Date.now(), v };
  return v;
}

