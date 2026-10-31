// Client for the E-Cinema Go API's internal routes.
export interface Statement {
  showtimeId: string;
  film: string;
  studio: string;
  payoutEmail: string;
  ended: boolean;
  paidSeats: number;
  grossCents: number;
  studioCents: number;
  currency: string;
  senderBatchId: string;
  status: "unpaid" | "pending" | "sent" | "failed" | "nothing_due";
  paypalBatchId?: string;
}

function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set`);
  return v;
}

export async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${env("API_URL")}${path}`, {
    method,
    headers: { authorization: `Bearer ${env("INTERNAL_API_TOKEN")}`, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    const detail = await res.json().catch(() => ({}));
    throw new Error(`${method} ${path} -> ${res.status} ${(detail as { error?: string }).error ?? ""}`.trim());
  }
  return (res.status === 204 ? undefined : await res.json()) as T;
}
