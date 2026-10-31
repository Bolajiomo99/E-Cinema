// Minimal PayPal REST client for Payouts (sandbox unless PAYPAL_ENV=live).
const base = () =>
  process.env.PAYPAL_API_BASE ?? // tests point this at a local fake
  (process.env.PAYPAL_ENV === "live" ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com");

let cached: { token: string; until: number } | undefined;

async function token(): Promise<string> {
  if (cached && cached.until > Date.now()) return cached.token;
  const id = process.env.PAYPAL_CLIENT_ID, secret = process.env.PAYPAL_CLIENT_SECRET;
  if (!id || !secret) throw new Error("PayPal credentials are not set");
  const res = await fetch(`${base()}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`PayPal token -> ${res.status}`);
  const data = (await res.json()) as { access_token: string; expires_in: number };
  cached = { token: data.access_token, until: Date.now() + (data.expires_in - 60) * 1000 };
  return cached.token;
}

export type PayoutResult = { status: "sent"; batchId: string } | { status: "duplicate" };

export async function sendPayout(p: {
  senderBatchId: string;
  receiver: string;
  cents: number;
  currency: string;
  note: string;
}): Promise<PayoutResult> {
  const res = await fetch(`${base()}/v1/payments/payouts`, {
    method: "POST",
    headers: { authorization: `Bearer ${await token()}`, "content-type": "application/json" },
    body: JSON.stringify({
      sender_batch_header: { sender_batch_id: p.senderBatchId, email_subject: "Your E-Cinema screening earnings" },
      items: [
        {
          recipient_type: "EMAIL",
          receiver: p.receiver,
          amount: { value: (p.cents / 100).toFixed(2), currency: p.currency },
          note: p.note,
          sender_item_id: p.senderBatchId,
        },
      ],
    }),
    signal: AbortSignal.timeout(30_000),
  });
  const data = (await res.json().catch(() => ({}))) as {
    name?: string;
    message?: string;
    details?: { issue?: string }[];
    batch_header?: { payout_batch_id: string };
  };
  // PayPal refuses a sender_batch_id it has already accepted, which means an earlier attempt went through.
  const said = [data.name, data.message, ...(data.details ?? []).map((d) => d.issue)].join(" ");
  if (res.status === 400 && /SENDER_BATCH_ID_ALREADY_EXISTS|sender_batch_id already exists/i.test(said)) {
    return { status: "duplicate" };
  }
  if (!res.ok || !data.batch_header) throw new Error(`PayPal payout -> ${res.status} ${data.name ?? ""}`.trim());
  return { status: "sent", batchId: data.batch_header.payout_batch_id };
}
