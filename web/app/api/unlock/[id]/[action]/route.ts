import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { CheckoutPaymentIntent } from "@paypal/paypal-server-sdk";
import { randomUUID } from "node:crypto";
import { accountApi, deviceLabel, SESSION_COOKIE } from "@/lib/auth";
import { findShowtime } from "@/lib/catalog";
import { emailEnabled, sendAdultCode } from "@/lib/email";
import { paypalError, paypalOrders } from "@/lib/paypal";
import { countryName } from "@/lib/plans";
import { createSeatOrder } from "@/lib/seat-order";
import { ADULT_STAGES, quote, salesOver } from "@/lib/ticket-quote";

// The 18+ unlock (Figma 28:839). Every stage needs the adult PIN and a fresh one-time code;
// stages 1 to 3 pay the charity, church and mosque funds, stage 4 is the seat.
export const dynamic = "force-dynamic";

const FUND_NAME = ["E-Cinema charity fund", "partner church fund", "partner mosque fund"];
type Stage = { stage: number; status: "pending" | "paid" };
type State = { status: { verified: boolean; pinSet: boolean }; stages: Stage[] };

const json = (status: number, body: unknown) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
const relay = (r: { status: number; body: unknown }) => (r.status === 204 ? new NextResponse(null, { status: 204 }) : json(r.status, r.body ?? {}));

function sameOrigin(req: NextRequest) {
  const origin = req.headers.get("origin");
  return !origin || origin === req.nextUrl.origin || new URL(origin).host === req.headers.get("host");
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string; action: string }> }) {
  if (!sameOrigin(req)) return json(403, { error: "forbidden" });
  const { id, action } = await params;
  const s = findShowtime(id);
  if (!s?.adult) return json(404, { error: "Not an adult title" });
  const session = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!session) return json(401, { error: "Sign in first", signIn: true });
  const b = (await req.json().catch(() => ({}))) as { pin?: string; code?: string };

  if (action === "pin") return relay(await accountApi("PUT", "/v1/me/adult/pin", { pin: b.pin }, session));

  const st = await accountApi("GET", `/v1/me/adult/${encodeURIComponent(s.id)}`, undefined, session);
  if (st.status !== 200) return relay(st);
  const state = st.body as State;
  const next = state.stages.filter((x) => x.status === "paid").length + 1;
  if (next > ADULT_STAGES) return json(409, { error: "All stages are paid" });

  if (action === "code") {
    if (!emailEnabled && process.env.NODE_ENV === "production" && !process.env.E2E_LOG_CODES) return json(503, { error: "Codes by email are being switched on. Please try again soon." });
    const r = await accountApi("POST", "/v1/me/adult/code", {}, session);
    if (r.status !== 200) return relay(r);
    const out = r.body as { code?: string; email?: string; phone?: string; maskedTo: string };
    if (out.code && out.email) {
      const cc = req.headers.get("cf-ipcountry") ?? "";
      const where = { device: await deviceLabel(), place: /^[A-Z]{2}$/.test(cc) && cc !== "XX" ? countryName(cc) : "" };
      if (emailEnabled) {
        try {
          await sendAdultCode(out.email, out.code, s.film, next, where);
        } catch {
          return json(502, { error: "We could not send the email just now. Please try again in a minute." });
        }
      } else if (process.env.E2E_LOG_CODES) console.log(`[e2e] adult code for ${out.email}: ${out.code}`);
    }
    return json(200, { sentTo: out.maskedTo, channel: out.phone ? "sms" : "email", stage: next });
  }

  if (action === "order") {
    const g = await accountApi("POST", "/v1/me/adult/grant", { pin: b.pin, code: b.code }, session);
    if (g.status !== 200) return relay(g);
    const grant = (g.body as { grant: string }).grant;
    if (next === ADULT_STAGES) {
      const used = await accountApi("POST", "/v1/me/adult/grant/use", { grant }, session);
      if (used.status !== 204) return relay(used);
      return createSeatOrder(s, session);
    }
    const prof = await accountApi("GET", "/v1/me/profile", undefined, session).catch(() => null);
    const q = quote(s, prof?.status === 200 ? (prof.body as { country?: string }) : undefined);
    if (salesOver(q.phase)) return json(410, { error: q.phase === "ended" ? "This premiere has ended" : "Doors have closed for this premiere" });
    const cur = q.currency;
    try {
      const { result } = await paypalOrders().createOrder({
        paypalRequestId: randomUUID(),
        prefer: "return=minimal",
        body: {
          intent: CheckoutPaymentIntent.Capture,
          purchaseUnits: [{
            referenceId: `${s.id}:stage${next}`,
            customId: `${s.id}:adult:${next}`,
            description: `E-Cinema 18+ unlock, stage ${next} of ${ADULT_STAGES}: ${FUND_NAME[next - 1]}`,
            amount: {
              currencyCode: cur, value: q.total,
              breakdown: { itemTotal: { currencyCode: cur, value: q.seat }, ...(Number(q.vat) ? { taxTotal: { currencyCode: cur, value: q.vat } } : {}) },
            },
            items: [{ name: `${s.film} · 18+ unlock stage ${next} of ${ADULT_STAGES} · ${FUND_NAME[next - 1]}`, quantity: "1", unitAmount: { currencyCode: cur, value: q.seat }, ...(Number(q.vat) ? { tax: { currencyCode: cur, value: q.vat } } : {}) }],
          }],
        },
      });
      if (!result.id) return json(502, { error: "PayPal did not return an order" });
      const a = await accountApi("POST", `/v1/me/adult/${encodeURIComponent(s.id)}/stages`, { stage: next, orderId: result.id, amountCents: Math.round(Number(q.total) * 100), currency: cur, grant }, session);
      if (a.status !== 204) return relay(a);
      return json(200, { orderId: result.id, stage: next });
    } catch (err) {
      return paypalError(err);
    }
  }
  return json(404, { error: "not found" });
}
