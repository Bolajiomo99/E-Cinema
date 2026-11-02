import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { accountApi } from "@/lib/auth";

// Executive dashboards (Figma page "07 Executive"). Every number comes from the Go API, which
// checks the caller's executive role on each request.

export type ExecRole = "ceo" | "cfo" | "coo" | "cto" | "cmo" | "investor" | "partner" | "stakeholder";
export type Command = {
  role: ExecRole; name: string;
  revenueToday: number; revenueWeekAgo: number; revenue30: number; revenuePrev30: number;
  paying: number; payingWeek: number; members: number; countries: number; countriesNew: number; liveNow: number;
  ordersToday: number; shopTodayNgn: number; studios: number; studiosWeek: number; nps: number; npsPrev: number; reviews: number;
  months: { month: string; grossCents: number; netCents: number }[];
  watching: { country: string; seats: number }[];
  decisions: { kind: string; count: number }[];
};
export type CommandPage = { command: Command; online: number; biggestRoom: number; onlineByCountry: { country: string; watching: number }[] };

export async function execRole(s: string): Promise<ExecRole | "" | null> {
  if (!s) return "";
  const r = await accountApi("GET", "/v1/me/exec", undefined, s);
  if (r.status !== 200) return null;
  return ((r.body as { role?: string }).role ?? "") as ExecRole | "";
}

export async function commandCenter(s: string): Promise<CommandPage | null> {
  const r = await accountApi("GET", "/v1/me/exec/command", undefined, s);
  return r.status === 200 ? (r.body as CommandPage) : null;
}

// The AI briefing: a few short observations Claude draws from the same numbers the page shows.
let client: Anthropic | null = null;
let cached: { key: string; at: number; items: string[] } | null = null;

export async function briefing(p: CommandPage, today: string): Promise<string[]> {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("off");
  const facts = JSON.stringify({ today, onlineNow: p.online, biggestRoom: p.biggestRoom, ...p.command, name: undefined, role: undefined });
  const key = facts;
  if (cached && cached.key === key && Date.now() - cached.at < 30 * 60_000) return cached.items;
  client ??= new Anthropic();
  const res = await client.messages.create({
    model: "claude-sonnet-5-5",
    max_tokens: 1200,
    output_config: {
      effort: "low",
      format: {
        type: "json_schema",
        schema: { type: "object", additionalProperties: false, required: ["items"], properties: { items: { type: "array", items: { type: "string" } } } },
      },
    },
    system: "You brief the CEO of E-Cinema, an online cinema that live-streams new films to watch-together audiences, from its own live numbers (JSON). " +
      "Write up to 4 observations, one or two plain sentences each, the most important first: what moved, what needs attention, what to decide. " +
      "Money fields ending in Cents are US cents; shopTodayNgn is naira. Use only the numbers given and never invent figures, places, products or causes. If the numbers are small or zero, say so plainly.",
    messages: [{ role: "user", content: facts }],
  }, { timeout: 60_000, maxRetries: 1 });
  const t = res.content.find((b) => b.type === "text");
  if (res.stop_reason === "refusal" || !t || t.type !== "text") throw new Error("no briefing");
  const items = (JSON.parse(t.text) as { items: string[] }).items.map((s) => s.trim()).filter(Boolean).slice(0, 4);
  cached = { key, at: Date.now(), items };
  return items;
}
