import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { paypalError, paypalOrders } from "@/lib/paypal";
import { markPaid } from "@/lib/api";

// Captures an approved order. Ticket issuing will hook in here once the database exists.
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!/^[A-Z0-9]{8,32}$/.test(id)) return NextResponse.json({ error: "Bad order id" }, { status: 400 });
  try {
    const { result } = await paypalOrders().captureOrder({ id, paypalRequestId: randomUUID(), prefer: "return=representation" });
    const capture = result.purchaseUnits?.[0]?.payments?.captures?.[0];
    // The webhook does this too; doing it here means the seat is confirmed straight away.
    if (result.status === "COMPLETED" && capture?.id) await markPaid(id, capture.id).catch((e) => console.error("Ledger update failed", e instanceof Error ? e.message : e));
    return NextResponse.json({ status: result.status, captureId: capture?.id, amount: capture?.amount });
  } catch (err) {
    return paypalError(err);
  }
}
