import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { randomUUID } from "node:crypto";
import { CheckoutPaymentIntent } from "@paypal/paypal-server-sdk";
import { findShowtime, showtimes } from "@/lib/catalog";
import { paypalOrders } from "@/lib/paypal";
import { shopFor, type ShopItem } from "@/lib/shop";

// The E-Cinema Concierge: Claude plans the booking, PayPal takes the payment.
// The agent can only prepare orders priced by the server. The viewer approves every payment in PayPal.

export type PendingOrder = { orderId: string; showtimeId: string; film: string; seats: number; total: string; currency: string };

const MAX_SEATS = 10;
const MAX_STEPS = 6;

const SYSTEM = `You are the E-Cinema Concierge. You help viewers find live film screenings and book seats.
Use list_showtimes to see what is on. When the viewer has chosen a screening and a number of seats, call create_ticket_order.
That prepares a PayPal order; the viewer then approves the payment themselves with the PayPal button shown under your reply.
After a booking, you may offer "Shop the film": call shop_the_film to show real products inspired by the film. Products are bought on the retailer's own site.
Never claim a payment is complete. Keep replies short, warm and clear. Times are in UTC unless the viewer gives a time zone.`;

const tools: Anthropic.Tool[] = [
  {
    name: "list_showtimes",
    description: "List upcoming live screenings with film, studio, start time (UTC) and price per seat.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
    strict: true,
  },
  {
    name: "create_ticket_order",
    description: "Prepare a PayPal order for seats at one screening. The viewer must still approve the payment in PayPal.",
    input_schema: {
      type: "object",
      properties: {
        showtimeId: { type: "string", description: "id from list_showtimes" },
        seats: { type: "integer", description: `number of seats, 1 to ${MAX_SEATS}` },
      },
      required: ["showtimeId", "seats"],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    name: "shop_the_film",
    description: "Find real products (clothes, accessories) inspired by a film's look. Shown to the viewer as product cards linking to the retailer.",
    input_schema: {
      type: "object",
      properties: { showtimeId: { type: "string", description: "id from list_showtimes" } },
      required: ["showtimeId"],
      additionalProperties: false,
    },
    strict: true,
  },
];

async function runTool(block: Anthropic.ToolUseBlock, orders: PendingOrder[], shop: ShopItem[]): Promise<Anthropic.ToolResultBlockParam> {
  const reply = (content: string, isError = false): Anthropic.ToolResultBlockParam => ({
    type: "tool_result",
    tool_use_id: block.id,
    content,
    is_error: isError,
  });

  if (block.name === "list_showtimes") return reply(JSON.stringify(showtimes));

  if (block.name === "create_ticket_order") {
    const { showtimeId, seats } = block.input as { showtimeId: string; seats: number };
    const showtime = findShowtime(showtimeId);
    if (!showtime) return reply("Unknown showtimeId. Call list_showtimes first.", true);
    if (!Number.isInteger(seats) || seats < 1 || seats > MAX_SEATS) return reply(`Seats must be 1 to ${MAX_SEATS}.`, true);

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
    orders.push({ orderId: result.id, showtimeId, film: showtime.film, seats, total, currency: showtime.price.currency });
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
export async function concierge(messages: Anthropic.Beta.BetaMessageParam[]) {
  client ??= new Anthropic();
  const orders: PendingOrder[] = [];
  const shop: ShopItem[] = [];

  for (let step = 0; step < MAX_STEPS; step++) {
    const response = await client.beta.messages.create({
      model: "claude-opus-5-5",
      max_tokens: 16000,
      output_config: { effort: "low" },
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: SYSTEM,
      tools,
      messages,
    });
    messages.push({ role: "assistant", content: response.content });

    if (response.stop_reason === "refusal") return { messages, orders, shop, refused: true };
    if (response.stop_reason === "pause_turn") continue;
    if (response.stop_reason !== "tool_use") return { messages, orders, shop, refused: false };

    const calls = response.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");
    const results = await Promise.all(
      calls.map((c) => runTool(c as unknown as Anthropic.ToolUseBlock, orders, shop).catch(() => ({
        type: "tool_result" as const,
        tool_use_id: c.id,
        content: "That step failed. Tell the viewer to try again shortly.",
        is_error: true,
      }))),
    );
    messages.push({ role: "user", content: results });
  }
  return { messages, orders, shop, refused: false };
}
