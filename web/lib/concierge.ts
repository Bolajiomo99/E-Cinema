import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { randomUUID } from "node:crypto";
import { CheckoutPaymentIntent } from "@paypal/paypal-server-sdk";
import { endsAt, findShowtime, showtimes } from "@/lib/catalog";
import { paypalOrders } from "@/lib/paypal";
import { shopFor, type ShopItem } from "@/lib/shop";
import { AdultOnlyError, RegionError, apiEnabled, attachOrder, holdSeats, myTickets, releaseHold, SoldOutError } from "@/lib/api";

// E-Cinema AI, the concierge: Claude plans the booking, PayPal takes the payment.
// The agent can only prepare orders priced by the server. The viewer approves every payment in PayPal.

export type PendingOrder = { orderId: string; showtimeId: string; film: string; seats: number; total: string; currency: string };
export type CalendarLink = { showtimeId: string; film: string; startsAt: string };
export type AgentOutput = { orders: PendingOrder[]; shop: ShopItem[]; calendar: CalendarLink[]; ticketsChanged: boolean };

const MAX_SEATS = 10;
const MAX_STEPS = 8;
// The agent never prepares a booking above this without the viewer saying yes in the chat first.
export const SPEND_LIMIT = Number(process.env.CONCIERGE_LIMIT_USD ?? 25);

const system = (tz: string) => `You are E-Cinema AI, the concierge of a global live cinema. Every film screens once, at the same moment for everyone.
You help viewers decide what to watch, book seats, manage their bookings, plan watch nights and shop the film.
It is now ${new Date().toISOString()} (UTC). The viewer's time zone is ${tz}: always give times in that zone, like "tonight at 20:30".
Use list_showtimes to see what is on (with genre, language, dubs, runtime and price) and my_tickets to see what the viewer already has.
When the viewer has chosen a screening and a number of seats, call create_ticket_order. That holds the seats for 10 minutes and prepares a PayPal order;
the viewer approves the payment themselves with the PayPal button under your reply. Never claim a payment is complete.
Spending limit: a booking above $${SPEND_LIMIT} total needs the viewer to say yes to that total in this chat first; only then set overLimitConfirmed to true.
If the viewer wants to change or cancel seats they have not paid for, call release_hold. Paid seats are refunded through Help, not by you.
Offer add_to_calendar after a booking or when the viewer wants a reminder. Offer shop_the_film when it fits, products are bought on the retailer's site.
Adult (18+) screenings need the face and ID check in the viewer's account; if booking fails for that reason, tell them where to do it (/settings/account).
Keep replies short, warm and clear. Use the viewer's language.`;

const tools: Anthropic.Tool[] = [
  {
    name: "list_showtimes",
    description: "List screenings that have not ended: id, film, studio, startsAt and endsAt (UTC), genres, category, original language, AI dub count, runtime, rating, adult flag and price per seat.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
    strict: true,
  },
  {
    name: "my_tickets",
    description: "The viewer's paid seats and the seats held for them that are waiting for PayPal approval (with holdId and minutes left).",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
    strict: true,
  },
  {
    name: "create_ticket_order",
    description: "Hold seats at one screening and prepare a PayPal order. The viewer must still approve the payment in PayPal.",
    input_schema: {
      type: "object",
      properties: {
        showtimeId: { type: "string", description: "id from list_showtimes" },
        seats: { type: "integer", description: `number of seats, 1 to ${MAX_SEATS}` },
        overLimitConfirmed: { type: "boolean", description: `true only if the total is above $${SPEND_LIMIT} and the viewer said yes to that total in this chat` },
      },
      required: ["showtimeId", "seats", "overLimitConfirmed"],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    name: "release_hold",
    description: "Give back seats the viewer is holding but has not paid for.",
    input_schema: {
      type: "object",
      properties: { holdId: { type: "string", description: "holdId from my_tickets" } },
      required: ["holdId"],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    name: "add_to_calendar",
    description: "Give the viewer a one-tap button that adds a premiere, with a 15-minute reminder, to their Google, Apple or Outlook calendar.",
    input_schema: {
      type: "object",
      properties: { showtimeId: { type: "string", description: "id from list_showtimes" } },
      required: ["showtimeId"],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    name: "shop_the_film",
    description: "Find real products (clothes, accessories) inspired by a film's look, through Channel3. Shown to the viewer as product cards linking to the retailer.",
    input_schema: {
      type: "object",
      properties: { showtimeId: { type: "string", description: "id from list_showtimes" } },
      required: ["showtimeId"],
      additionalProperties: false,
    },
    strict: true,
  },
];

async function runTool(block: Anthropic.ToolUseBlock, out: AgentOutput, session?: string): Promise<Anthropic.ToolResultBlockParam> {
  const { orders, shop } = out;
  const reply = (content: string, isError = false): Anthropic.ToolResultBlockParam => ({
    type: "tool_result",
    tool_use_id: block.id,
    content,
    is_error: isError,
  });

  if (block.name === "list_showtimes") {
    const now = Date.now();
    return reply(JSON.stringify(showtimes.filter((s) => endsAt(s) > now).map((s) => {
      const { shopQuery: _q, poster: _p, featured: _f, ...rest } = s;
      return { ...rest, endsAt: new Date(endsAt(s)).toISOString() };
    })));
  }

  if (block.name === "my_tickets") {
    if (!session) return reply("The viewer is not signed in, so they have no tickets yet. Ask them to sign in at /signin.", true);
    const list = await myTickets(session);
    return reply(JSON.stringify(list.map((t) => ({
      ...t, film: findShowtime(t.showtimeId)?.film, startsAt: findShowtime(t.showtimeId)?.startsAt,
      minutesLeftToPay: t.status === "held" ? Math.max(0, Math.round((Date.parse(t.expiresAt) - Date.now()) / 60_000)) : undefined,
    }))));
  }

  if (block.name === "release_hold") {
    if (!session) return reply("The viewer is not signed in.", true);
    await releaseHold(session, (block.input as { holdId: string }).holdId);
    out.ticketsChanged = true;
    return reply("Released. The seats are back on sale.");
  }

  if (block.name === "add_to_calendar") {
    const showtime = findShowtime((block.input as { showtimeId: string }).showtimeId);
    if (!showtime) return reply("Unknown showtimeId. Call list_showtimes first.", true);
    if (!out.calendar.some((c) => c.showtimeId === showtime.id)) out.calendar.push({ showtimeId: showtime.id, film: showtime.film, startsAt: showtime.startsAt });
    return reply("A calendar button is now shown under your reply.");
  }

  if (block.name === "create_ticket_order") {
    const { showtimeId, seats, overLimitConfirmed } = block.input as { showtimeId: string; seats: number; overLimitConfirmed: boolean };
    const showtime = findShowtime(showtimeId);
    if (!showtime) return reply("Unknown showtimeId. Call list_showtimes first.", true);
    if (!Number.isInteger(seats) || seats < 1 || seats > MAX_SEATS) return reply(`Seats must be 1 to ${MAX_SEATS}.`, true);

    if (apiEnabled && !session) return reply("The viewer is not signed in. Tickets belong to an account, so ask them to sign in at /signin first, then try again.", true);
    const totalUsd = Number(showtime.price.value) * seats;
    if (totalUsd > SPEND_LIMIT && !overLimitConfirmed) {
      return reply(`That is $${totalUsd.toFixed(2)}, above the $${SPEND_LIMIT} spending limit. Ask the viewer to confirm this total first.`, true);
    }
    let hold;
    try {
      hold = await holdSeats(showtime.id, seats, randomUUID(), session, "hd", "concierge");
    } catch (err) {
      if (err instanceof SoldOutError) return reply("Not enough seats left for that screening. Offer another one.", true);
      if (err instanceof RegionError) return reply("The studio does not sell this film in the viewer's country, so it cannot be booked from there. Suggest another film.", true);
      if (err instanceof AdultOnlyError) return reply("This is an 18+ screening and the viewer has not passed the face and ID check. Point them to /settings/account to do it.", true);
      throw err;
    }
    const unitCents = Math.round(Number(showtime.price.value) * 100);
    const total = ((unitCents * seats) / 100).toFixed(2);
    const { result } = await paypalOrders().createOrder({
      paypalRequestId: randomUUID(),
      body: {
        intent: CheckoutPaymentIntent.Capture,
        purchaseUnits: [
          {
            referenceId: showtime.id,
            customId: `${showtime.id}:${seats}`,
            description: `E-Cinema: ${seats} seat(s) for ${showtime.film}`,
            amount: { currencyCode: showtime.price.currency, value: total },
          },
        ],
      },
    });
    if (!result.id) return reply("PayPal did not return an order.", true);
    if (hold) await attachOrder(hold.id, result.id);
    orders.push({ orderId: result.id, showtimeId, film: showtime.film, seats, total, currency: showtime.price.currency });
    out.ticketsChanged = true;
    return reply(JSON.stringify({ orderId: result.id, total, currency: showtime.price.currency, status: "awaiting viewer approval in PayPal" }));
  }

  if (block.name === "shop_the_film") {
    const showtime = findShowtime((block.input as { showtimeId: string }).showtimeId);
    if (!showtime) return reply("Unknown showtimeId. Call list_showtimes first.", true);
    const items = await shopFor(showtime.shopQuery);
    shop.push(...items);
    return reply(JSON.stringify(items.map(({ title, brand, price, currency, store }) => ({ title, brand, price, currency, store }))));
  }

  return reply(`Unknown tool ${block.name}`, true);
}

let client: Anthropic | undefined;

// Runs one viewer turn. `messages` is the full conversation so far, ending with the viewer's message.
export async function concierge(messages: Anthropic.Beta.BetaMessageParam[], session?: string, tz = "UTC") {
  client ??= new Anthropic();
  const out: AgentOutput = { orders: [], shop: [], calendar: [], ticketsChanged: false };

  for (let step = 0; step < MAX_STEPS; step++) {
    const response = await client.beta.messages.create({
      model: "claude-opus-5-5",
      max_tokens: 16000,
      output_config: { effort: "low" },
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: system(tz),
      tools,
      messages,
    });
    messages.push({ role: "assistant", content: response.content });

    if (response.stop_reason === "refusal") return { messages, ...out, refused: true };
    if (response.stop_reason === "pause_turn") continue;
    if (response.stop_reason !== "tool_use") return { messages, ...out, refused: false };

    const calls = response.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");
    const results = await Promise.all(
      calls.map((c) => runTool(c as unknown as Anthropic.ToolUseBlock, out, session).catch(() => ({
        type: "tool_result" as const,
        tool_use_id: c.id,
        content: "That step failed. Tell the viewer to try again shortly.",
        is_error: true,
      }))),
    );
    messages.push({ role: "user", content: results });
  }
  return { messages, ...out, refused: false };
}
