// Studio payouts: after a screening ends, the studio gets its share by PayPal Payouts, or by
// bank transfer through Flutterwave when the studio chose a bank account.
import { type TaskContext, task } from "@renderinc/sdk/workflows";
import { api, type Statement } from "./api.js";
import { convert, sendTransfer, transferState } from "./flutterwave.js";
import { sendPayout } from "./paypal.js";

export const payStudio = task(
  {
    name: "payStudio",
    timeoutSeconds: 300,
    plan: "starter",
    retry: { maxRetries: 4, waitDurationMs: 5_000, backoffScaling: 2 },
  },
  async function payStudio(_ctx: TaskContext, showtimeId: string) {
    if (!/^[a-z0-9-]{1,80}$/.test(showtimeId)) throw new Error("invalid showtime id");
    const id = encodeURIComponent(showtimeId);
    // Claiming freezes the amount; repeating it is safe.
    const st = await api<Statement>("POST", `/v1/showtimes/${id}/payout`);
    if (st.status === "sent" || st.status === "nothing_due") {
      console.log(`${showtimeId}: ${st.status}, nothing to do`);
      return { showtimeId, status: st.status, studioCents: st.studioCents, currency: st.currency };
    }
    if (st.method === "bank") return payByBank(showtimeId, st);
    const result = await sendPayout({
      senderBatchId: st.senderBatchId,
      receiver: st.payoutEmail,
      cents: st.studioCents,
      currency: st.currency,
      note: `${st.film}: ${st.paidSeats} seats, ${(st.grossCents / 100).toFixed(2)} ${st.currency} gross`,
    });
    const batchId = result.status === "sent" ? result.batchId : "";
    await api("POST", `/v1/showtimes/${id}/payout/result`, { status: "sent", batchId });
    console.log(`${showtimeId}: paid ${st.studio} ${(st.studioCents / 100).toFixed(2)} ${st.currency}`);
    return { showtimeId, status: "sent", studioCents: st.studioCents, currency: st.currency, batchId };
  },
);

async function payByBank(showtimeId: string, st: Statement) {
  const id = encodeURIComponent(showtimeId);
  const report = (body: Record<string, unknown>) => api("POST", `/v1/showtimes/${id}/payout/result`, body);
  const done = (status: string, extra: Record<string, unknown> = {}) => {
    console.log(`${showtimeId}: bank transfer ${status}${extra.message ? ` (${extra.message})` : ""}`);
    return { showtimeId, status, method: "bank", studioCents: st.studioCents, currency: st.currency, ...extra };
  };
  let transferId = st.transferId ?? "";
  if (!transferId) {
    const currency = st.payoutCurrency || st.currency;
    const amount = await convert(st.studioCents / 100, st.currency, currency);
    if (amount <= 0) throw new Error(`${showtimeId}: converted amount is zero`);
    const t = await sendTransfer({
      reference: st.reference || st.senderBatchId,
      bankCode: st.bankCode ?? "",
      accountNumber: st.accountNumber ?? "",
      accountName: st.accountName ?? "",
      amount,
      currency,
      narration: `E-Cinema ${st.film} ${st.paidSeats} seats`,
    });
    if (t.state === "failed") {
      await report({ status: "failed" });
      return done("failed", { message: t.message });
    }
    transferId = t.id;
    await report({ status: "submitted", transferId, paidCurrency: currency, paidMinor: Math.round(amount * 100) });
  }
  // Transfers usually settle within a minute; anything slower is picked up by the next sweep.
  for (let i = 0; i < 6; i++) {
    const s = await transferState(transferId);
    if (s.state === "sent") {
      await report({ status: "sent", transferId });
      return done("sent", { transferId });
    }
    if (s.state === "failed") {
      await report({ status: "failed" });
      return done("failed", { transferId, message: s.message });
    }
    await new Promise((r) => setTimeout(r, Number(process.env.FLW_POLL_MS ?? 10_000)));
  }
  return done("pending", { transferId });
}

export const payEndedScreenings = task(
  { name: "payEndedScreenings", timeoutSeconds: 3_600, plan: "starter" },
  async function payEndedScreenings(ctx: TaskContext) {
    const { showtimeIds } = await api<{ showtimeIds: string[] }>("GET", "/v1/payouts/due");
    console.log(`${showtimeIds.length} screenings due`);
    // Each studio payout runs on its own instance; one failure does not stop the others.
    const results = await Promise.allSettled(showtimeIds.map((id) => ctx.run(payStudio, id)));
    const failed = results.flatMap((r, i) => (r.status === "rejected" ? [showtimeIds[i]] : []));
    return {
      due: showtimeIds.length,
      paid: results.filter((r) => r.status === "fulfilled").map((r) => (r as PromiseFulfilledResult<unknown>).value),
      failed,
    };
  },
);
