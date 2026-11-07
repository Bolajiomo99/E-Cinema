// Uptime shapes shared by the server reader (lib/uptime.ts) and the executive pages.
export type UptimeIncident = { monitor: string; at: string; minutes: number; reason: string; open: boolean };
export type Uptime = { day: number; month: number; quarter: number; up: boolean; monitors: number; incidents: UptimeIncident[] };

export const pct = (n: number) => `${n >= 99.995 ? "100" : n.toFixed(2)}%`;
