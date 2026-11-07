// Minimal Flutterwave v3 client for studio bank transfers. FLW_SECRET_KEY decides the mode:
// a FLWSECK_TEST- key moves only test money.
const base = () => process.env.FLW_API_BASE ?? "https://api.flutterwave.com/v3"; // tests point this at a local fake

function key(): string {
  const k = process.env.FLW_SECRET_KEY;
  if (!k) throw new Error("FLW_SECRET_KEY is not set");
  return k;
}

type Reply<T> = { status?: string; message?: string; data?: T };

async function flw<T>(method: string, path: string, body?: unknown): Promise<{ ok: boolean; status: number; reply: Reply<T> }> {
  const res = await fetch(`${base()}${path}`, {
    method,
    headers: { authorization: `Bearer ${key()}`, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  const reply = (await res.json().catch(() => ({}))) as Reply<T>;
  return { ok: res.ok && reply.status === "success", status: res.status, reply };
}

// convert turns an amount into the payout currency at Flutterwave's transfer rate.
export async function convert(amount: number, from: string, to: string): Promise<number> {
  if (from === to) return amount;
  const q = new URLSearchParams({ amount: amount.toFixed(2), source_currency: from, destination_currency: to });
  const r = await flw<{ source?: { amount: number }; destination?: { amount: number } }>("GET", `/transfers/rates?${q}`);
  const src = r.reply.data?.source?.amount, dst = r.reply.data?.destination?.amount;
  if (!r.ok || !src || !dst) throw new Error(`Flutterwave rate ${from}->${to} failed: ${r.reply.message ?? r.status}`);
  // "amount" is the destination amount, so destination/source is what one unit of `from` buys.
  return Math.floor(amount * (dst / src) * 100) / 100;
}

export type TransferState = "submitted" | "sent" | "failed";

export async function sendTransfer(t: {
  reference: string;
  bankCode: string;
  accountNumber: string;
  accountName: string;
  amount: number;
  currency: string;
  narration: string;
}): Promise<{ id: string; state: TransferState; message?: string }> {
  const r = await flw<{ id: number; status: string; complete_message?: string }>("POST", "/transfers", {
    account_bank: t.bankCode,
    account_number: t.accountNumber.replace(/\s+/g, ""),
    amount: t.amount,
    currency: t.currency,
    debit_currency: process.env.FLW_DEBIT_CURRENCY || t.currency,
    beneficiary_name: t.accountName,
    narration: t.narration.slice(0, 100),
    reference: t.reference,
  });
  if (r.ok && r.reply.data?.id) return { id: String(r.reply.data.id), state: stateOf(r.reply.data.status), message: r.reply.data.complete_message };
  const msg = r.reply.message ?? `HTTP ${r.status}`;
  // A reference Flutterwave already holds means an earlier attempt of this task got through
  // before it could be recorded. Never send it again; the run fails and staff look it up.
  if (/reference/i.test(msg) && /(exist|duplicate|already)/i.test(msg)) throw new Error(`transfer ${t.reference} already exists at Flutterwave; check it before paying again`);
  // A 4xx with a clear refusal (bad account, unsupported bank) is final for this attempt.
  if (r.status >= 400 && r.status < 500 && r.status !== 429) return { id: "", state: "failed", message: msg };
  throw new Error(`Flutterwave transfer failed: ${msg}`);
}

export async function transferState(id: string): Promise<{ state: TransferState; message?: string }> {
  const r = await flw<{ status: string; complete_message?: string }>("GET", `/transfers/${encodeURIComponent(id)}`);
  if (!r.ok || !r.reply.data) throw new Error(`Flutterwave transfer ${id} lookup failed: ${r.reply.message ?? r.status}`);
  return { state: stateOf(r.reply.data.status), message: r.reply.data.complete_message };
}

function stateOf(s: string): TransferState {
  const v = s.toUpperCase();
  if (v === "SUCCESSFUL") return "sent";
  if (v === "FAILED") return "failed";
  return "submitted"; // NEW, PENDING
}
