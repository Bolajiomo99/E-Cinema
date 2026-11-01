import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { cookies } from "next/headers";
import { concierge } from "@/lib/concierge";
import { SESSION_COOKIE } from "@/lib/auth";

const MAX_TURNS = 60;

// Only real IANA zones reach the prompt.
function validZone(tz?: string) {
  if (!tz || tz.length > 64) return "UTC";
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
    return tz;
  } catch {
    return "UTC";
  }
}

// One concierge turn. The browser keeps the conversation and sends it back unchanged each time.
export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { messages?: Anthropic.Beta.BetaMessageParam[]; tz?: string } | null;
  const messages = body?.messages;
  if (!Array.isArray(messages) || messages.length === 0 || messages.length > MAX_TURNS || messages.at(-1)?.role !== "user") {
    return NextResponse.json({ error: "Bad conversation" }, { status: 400 });
  }
  if (!process.env.ANTHROPIC_API_KEY) return NextResponse.json({ error: "Concierge is not configured" }, { status: 503 });

  try {
    const result = await concierge(messages, (await cookies()).get(SESSION_COOKIE)?.value, validZone(body?.tz));
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof Anthropic.RateLimitError) return NextResponse.json({ error: "Busy, try again" }, { status: 429 });
    if (err instanceof Anthropic.APIError) {
      console.error("Concierge API error", err.status, err.requestID ?? "", err.message.slice(0, 300));
      return NextResponse.json({ error: "Concierge unavailable" }, { status: 502 });
    }
    console.error("Concierge error", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Concierge unavailable" }, { status: 500 });
  }
}
