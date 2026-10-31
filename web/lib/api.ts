import "server-only";

// Talks to the Go API (seat holds and the ticket ledger). Without API_URL the web app
// still takes payments, but seats are not reserved, which is only acceptable in development.
const base = process.env.API_URL;
const token = process.env.INTERNAL_API_TOKEN;

export const apiEnabled = Boolean(base && token);

export class SoldOutError extends Error {}
export class AdultOnlyError extends Error {}

async function call<T>(path: string, body: unknown, session?: string): Promise<T | undefined> {
  const res = await fetch(`${base}${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(session ? { "X-Session-Token": session } : {}) },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(8000),
  });
  if (res.status === 409) throw new SoldOutError("Not enough seats left");
  if (res.status === 403) throw new AdultOnlyError("This screening is for verified adults");
  if (!res.ok) throw new Error(`API ${path} ${res.status}`);
  return res.status === 204 ? undefined : ((await res.json()) as T);
}

export type Hold = { id: string; totalCents: number; currency: string; expiresAt: string };

// With the buyer's session the API links the seats to their account, which is what lets
// them into the watch room later.
export async function holdSeats(showtimeId: string, seats: number, viewerRef: string, session?: string): Promise<Hold | undefined> {
  if (!apiEnabled) return undefined;
  return call<Hold>(`/v1/showtimes/${encodeURIComponent(showtimeId)}/holds`, { seats, viewerRef }, session);
}

export async function attachOrder(holdId: string, orderId: string) {
  if (apiEnabled) await call(`/v1/holds/${encodeURIComponent(holdId)}/order`, { orderId });
}

export async function markPaid(orderId: string, captureId: string) {
  if (apiEnabled) await call(`/v1/payments/captured`, { orderId, captureId });
}

export type MyTicket = { holdId: string; showtimeId: string; seats: number; status: "held" | "paid"; orderId?: string; expiresAt: string };

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
