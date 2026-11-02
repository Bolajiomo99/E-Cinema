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

export type ExecMe = { role: ExecRole | ""; money: boolean };

export async function execMe(s: string): Promise<ExecMe | null> {
  if (!s) return { role: "", money: false };
  const r = await accountApi("GET", "/v1/me/exec", undefined, s);
  if (r.status !== 200) return null;
  const b = r.body as { role?: string; money?: boolean };
  return { role: (b.role ?? "") as ExecRole | "", money: Boolean(b.money) };
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

export type ExecPerson = {
  email: string; name: string; org: string; role: ExecRole; scopes: string[]; canAdd: boolean; canMoney: boolean; watermark: boolean;
  expiresOn: string; expired: boolean; joined: boolean; lastActive: string | null; addedAt: string;
};

export async function execPeople(s: string): Promise<ExecPerson[] | null> {
  const r = await accountApi("GET", "/v1/me/exec/people", undefined, s);
  return r.status === 200 ? ((r.body as { people: ExecPerson[] }).people ?? []) : null;
}

export type MoneyData = {
  days: number;
  rows: { source: string; currency: string; gross: number; net: number; prev: boolean }[];
  regions: { country: string; currency: string; net: number }[];
  providers: { provider: string; currency: string; volume: number; paid: number; tried: number; refunded: number; countries: string[] }[];
  refunds: [number, number, number, number];
  out: { what: string; currency: string; minor: number }[];
};

export async function execMoney(s: string, days: number): Promise<MoneyData | null> {
  const r = await accountApi("GET", `/v1/me/exec/money?days=${days}`, undefined, s);
  return r.status === 200 ? (r.body as MoneyData) : null;
}

export type GrowthData = {
  days: number; country: string; members: number; membersPrev: number; daily: number; newWeek: number; newWeekPrev: number; paying: number;
  months: { month: string; grossCents: number }[];
  funnel: [number, number, number, number];
  countries: { country: string; members: number; paid: number; new: number; newPrev: number }[];
  cohorts: { month: string; size: number; weeks: number[] }[];
  plans: Record<string, number>;
  countryList: string[];
};

export async function execGrowth(s: string, days: number, country: string): Promise<GrowthData | null> {
  const r = await accountApi("GET", `/v1/me/exec/growth?days=${days}&country=${encodeURIComponent(country)}`, undefined, s);
  return r.status === 200 ? (r.body as GrowthData) : null;
}

export type ContentData = {
  screening: number; countries: number; studios: number; studiosWaiting: number; comingSoon: number; preSales: number; rating: number; reviews: number;
  films: { film: string; studio: string; showtime: string; genres: string; starts: string; ends: string; countries: number; seats: number; state: "screening" | "presale" | "ended" | "waiting" }[];
  pending: { name: string; slug: string; city: string; country: string; docsOk: boolean; hasDocs: boolean; hasBank: boolean; rights: boolean; since: string }[];
  dubs: { lang: string; total: number; approved: number; working: number; failed: number }[];
};

export async function execContent(s: string): Promise<ContentData | null> {
  const r = await accountApi("GET", "/v1/me/exec/content", undefined, s);
  return r.status === 200 ? (r.body as ContentData) : null;
}

export type LiveData = { playing: { id: string; film: string; studio: string; starts: string; ends: string; watching: number; peak: number; byCountry: Record<string, number> }[] };

export async function execLive(s: string): Promise<LiveData | null> {
  const r = await accountApi("GET", "/v1/me/exec/live", undefined, s);
  return r.status === 200 ? (r.body as LiveData) : null;
}
