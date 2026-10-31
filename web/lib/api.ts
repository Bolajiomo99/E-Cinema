import "server-only";

// Talks to the Go API (seat holds and the ticket ledger). Without API_URL the web app
// still takes payments, but seats are not reserved, which is only acceptable in development.
const base = process.env.API_URL;
const token = process.env.INTERNAL_API_TOKEN;

export const apiEnabled = Boolean(base && token);

export class SoldOutError extends Error {}

async function call<T>(path: string, body: unknown): Promise<T | undefined> {
  const res = await fetch(`${base}${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(8000),
  });
  if (res.status === 409) throw new SoldOutError("Not enough seats left");
  if (!res.ok) throw new Error(`API ${path} ${res.status}`);
  return res.status === 204 ? undefined : ((await res.json()) as T);
}

export type Hold = { id: string; totalCents: number; currency: string; expiresAt: string };

export async function holdSeats(showtimeId: string, seats: number, viewerRef: string): Promise<Hold | undefined> {
  if (!apiEnabled) return undefined;
  return call<Hold>(`/v1/showtimes/${encodeURIComponent(showtimeId)}/holds`, { seats, viewerRef });
}

export async function attachOrder(holdId: string, orderId: string) {
  if (apiEnabled) await call(`/v1/holds/${encodeURIComponent(holdId)}/order`, { orderId });
}

export async function markPaid(orderId: string, captureId: string) {
  if (apiEnabled) await call(`/v1/payments/captured`, { orderId, captureId });
}
