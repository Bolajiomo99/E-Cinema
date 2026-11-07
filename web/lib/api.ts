import "server-only";
import { cookies, headers } from "next/headers";

// Talks to the Go API (seat holds and the ticket ledger). Without API_URL the web app
// still takes payments, but seats are not reserved, which is only acceptable in development.
const base = process.env.API_URL;
const token = process.env.INTERNAL_API_TOKEN;

export const apiEnabled = Boolean(base && token);

export class SoldOutError extends Error {}
export class AdultOnlyError extends Error {}
export class RegionError extends Error {}
export const REGION_MSG = "This film is not offered in your country. The studio does not sell it there.";

async function call<T>(path: string, body: unknown, session?: string): Promise<T | undefined> {
  const res = await fetch(`${base}${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(session ? { "X-Session-Token": session } : {}) },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(8000),
  });
  if (res.status === 409) throw new SoldOutError("Not enough seats left");
  if (res.status === 451) throw new RegionError(REGION_MSG);
  if (res.status === 403) throw new AdultOnlyError("This screening is for verified adults");
  if (!res.ok) throw new Error(`API ${path} ${res.status}`);
  return res.status === 204 ? undefined : ((await res.json()) as T);
}

export type Hold = { id: string; totalCents: number; currency: string; expiresAt: string };

// With the buyer's session the API links the seats to their account, which is what lets
// them into the watch room later.
export async function holdSeats(showtimeId: string, seats: number, viewerRef: string, session?: string, quality = "hd", via: "web" | "concierge" = "web"): Promise<Hold | undefined> {
  if (!apiEnabled) return undefined;
  return call<Hold>(`/v1/showtimes/${encodeURIComponent(showtimeId)}/holds`, { seats, viewerRef, quality, campaign: await campaignCode(), via, country: await edgeCountry() }, session);
}

// Where the buyer is, as Cloudflare sees it, so a studio's blocked territories hold.
async function edgeCountry(): Promise<string> {
  try {
    const c = ((await headers()).get("cf-ipcountry") ?? "").toUpperCase();
    return /^[A-Z]{2}$/.test(c) ? c : "";
  } catch {
    return "";
  }
}

// The studio campaign link (e-cinema.net/c/<code>) the buyer arrived through, so the studio can
// see which campaign sold the seat. The API only counts it for the same screening.
async function campaignCode(): Promise<string> {
  try {
    const c = (await cookies()).get("ec_cmp")?.value ?? "";
    return /^[a-z0-9]{8}$/.test(c) ? c : "";
  } catch {
    return "";
  }
}

// netCents: what the order charges for the seats before VAT, which the studio's share is worked out from.
export async function attachOrder(holdId: string, orderId: string, netCents = 0) {
  if (apiEnabled) await call(`/v1/holds/${encodeURIComponent(holdId)}/order`, { orderId, netCents });
}

export async function markPaid(orderId: string, captureId: string) {
  if (apiEnabled) await call(`/v1/payments/captured`, { orderId, captureId });
}

// Pay in 6: saves the card Paystack kept after the first part, so later parts can be charged.
export async function startInstalments(reference: string, authCode: string, email: string) {
  if (apiEnabled) await call(`/v1/shop/instalments/start`, { reference, authCode, email });
}

export async function markRefunded(captureId: string, refundId: string) {
  if (apiEnabled) await call(`/v1/payments/refunded`, { captureId, refundId });
}

// Checks a paid seat is the viewer's and still cancellable; returns the PayPal capture to refund.
export async function cancellable(session: string, holdId: string): Promise<{ ok: true; captureId: string } | { ok: false; status: number; error: string }> {
  const res = await fetch(`${base}/v1/me/holds/${encodeURIComponent(holdId)}/cancel`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "X-Session-Token": session },
    signal: AbortSignal.timeout(8000),
    cache: "no-store",
  });
  const body = (await res.json().catch(() => ({}))) as { captureId?: string; error?: string };
  return res.ok && body.captureId ? { ok: true, captureId: body.captureId } : { ok: false, status: res.status, error: body.error ?? "Could not cancel" };
}

export type MyTicket = { holdId: string; showtimeId: string; seats: number; status: "held" | "paid"; quality?: "hd" | "4k" | "vr"; orderId?: string; expiresAt: string; createdAt?: string; refundUntil?: string; movedFrom?: string };

async function viewer<T>(method: string, path: string, session: string): Promise<T | undefined> {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, "X-Session-Token": session },
    signal: AbortSignal.timeout(8000),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`API ${path} ${res.status}`);
  return res.status === 204 ? undefined : ((await res.json()) as T);
}

// The viewer's paid seats and the holds waiting for their PayPal approval.
export async function myTickets(session?: string): Promise<MyTicket[]> {
  if (!apiEnabled || !session) return [];
  return (await viewer<MyTicket[]>("GET", "/v1/me/tickets", session)) ?? [];
}

export async function releaseHold(session: string, holdId: string) {
  if (apiEnabled) await viewer("DELETE", `/v1/me/holds/${encodeURIComponent(holdId)}`, session);
}

export type LiveStat = {
  showtimeId: string;
  watching: number;
  countries: number;
  byCountry?: Record<string, number>; // distinct viewers per home country
  chatByCountry?: Record<string, number>; // messages per home country, last 10 minutes
};

// Audience numbers for every room with people in it (public, counts only).
export async function liveStats(): Promise<LiveStat[]> {
  if (!base) return [];
  try {
    const r = await fetch(`${base}/v1/live`, { signal: AbortSignal.timeout(2500), cache: "no-store" });
    return r.ok ? ((await r.json()) as LiveStat[]) : [];
  } catch {
    return [];
  }
}

export type TonightStat = { showtimeId: string; seats: number; byCountry: Record<string, number> };

// Paid seats for screenings in the next 24 hours, by the buyers' home countries (counts only).
export async function tonightAudience(): Promise<TonightStat[]> {
  if (!base) return [];
  try {
    const r = await fetch(`${base}/v1/audience/tonight`, { signal: AbortSignal.timeout(2500), cache: "no-store" });
    return r.ok ? ((await r.json()) as TonightStat[]) : [];
  } catch {
    return [];
  }
}

export type Seats = { capacity: number; available: number };

// Seats left for one premiere (paid seats and live holds count as taken).
export async function seatsFor(showtimeId: string): Promise<Seats | null> {
  if (!base) return null;
  try {
    const r = await fetch(`${base}/v1/showtimes/${encodeURIComponent(showtimeId)}`, { signal: AbortSignal.timeout(2500), cache: "no-store" });
    if (!r.ok) return null;
    const b = (await r.json()) as Seats;
    return { capacity: b.capacity, available: Math.max(0, b.available) };
  } catch {
    return null;
  }
}
