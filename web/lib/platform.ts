import "server-only";

// Platform switches the CEO sets in Executive > Settings (Figma 83:386), read from the API and
// refreshed every 30 seconds with the live catalog. Until the first read everything is on.
export type Switches = Record<string, boolean | string>;
let current: Switches = {};
let last = 0;

export async function refreshPlatform(force = false) {
  const base = process.env.API_URL;
  if (!base || (!force && Date.now() - last < 30_000)) return;
  try {
    const r = await fetch(`${base}/v1/platform`, { signal: AbortSignal.timeout(5000), cache: "no-store" });
    if (r.ok) { current = (await r.json()) as Switches; last = Date.now(); }
  } catch {
    // keep the last known switches
  }
}

// switchOn says whether a boolean switch is on (true when unknown).
export const switchOn = (key: string) => current[key] !== false;
export const supportEmail = () => (typeof current["company.support"] === "string" ? (current["company.support"] as string) : "help@e-cinema.net");
