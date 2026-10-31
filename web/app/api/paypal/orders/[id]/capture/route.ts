import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { paypalError, paypalOrders } from "@/lib/paypal";

// Captures an approved order. Ticket issuing will hook in here once the database exists.
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!/^[A-Z0-9]{8,32}$/.test(id)) return NextResponse.json({ error: "Bad order id" }, { status: 400 });
  try {
    const { result } = await paypalOrders().captureOrder({ id, paypalRequestId: randomUUID(), prefer: "return=representation" });
    const capture = result.purchaseUnits?.[0]?.payments?.captures?.[0];
    return NextResponse.json({ status: result.status, captureId: capture?.id, amount: capture?.amount });
  } catch (err) {
    return paypalError(err);
  }
}
