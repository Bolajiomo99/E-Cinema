import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { cancellable, markRefunded } from "@/lib/api";
import { accountApi, SESSION_COOKIE } from "@/lib/auth";
import { paypalError, paypalPayments } from "@/lib/paypal";

// POST /api/tickets/{holdId}/cancel: free cancellation until 7 days before the screening
// (Figma "Web / Pre-order", 52:958). Refunds the PayPal capture in full, then frees the seat.
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const origin = req.headers.get("origin");
  if (origin && new URL(origin).host !== req.headers.get("host")) {
    return NextResponse.json({ error: "cross-site request" }, { status: 403 });
  }
  if (!/^[0-9a-f-]{36}$/.test(id)) return NextResponse.json({ error: "Bad ticket" }, { status: 400 });
  const session = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!session) return NextResponse.json({ error: "Sign in first", signIn: true }, { status: 401 });

  const c = await cancellable(session, id);
  if (!c.ok) return NextResponse.json({ error: c.error }, { status: c.status === 401 ? 401 : c.status === 409 ? 409 : 400 });
  // Paid with gift credit: the credit goes back to the account.
  if (c.captureId === `CREDIT-${id}`) {
    const r = await accountApi("POST", `/v1/me/holds/${id}/credit/refund`, {}, session);
    return NextResponse.json(r.status === 200 ? { status: "COMPLETED", credit: true } : r.body ?? {}, { status: r.status === 200 ? 200 : 409 });
  }
  try {
    // The hold id as the request id: a double click refunds once.
    const { result } = await paypalPayments().refundCapturedPayment({ captureId: c.captureId, paypalRequestId: `refund-${id}`, prefer: "return=minimal" });
    if (!result.id) return NextResponse.json({ error: "Refund not confirmed, try again" }, { status: 502 });
    // The PAYMENT.CAPTURE.REFUNDED webhook does this too.
    await markRefunded(c.captureId, result.id).catch((e) => console.error("Refund ledger update failed", e instanceof Error ? e.message : e));
    return NextResponse.json({ status: result.status, refundId: result.id });
  } catch (err) {
    return paypalError(err);
  }
}
