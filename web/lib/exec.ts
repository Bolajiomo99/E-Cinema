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

export type ShopProduct = {
  id: string; name: string; sub: string; blurb: string; category: string; priceNgn: number; options: { name: string; values: string[] }[] | null;
  ships: string; shipDays: number; beforeShow: boolean; images: string[]; active: boolean; licence: string; sold: number; revenueNgn: number;
};
export type ShopData = { orders: number; ordersPrev: number; revenueNgn: number; delivered: number; onTime: number; destinations: Record<string, number>; products: ShopProduct[]; canAdd: boolean };

export async function execShop(s: string): Promise<ShopData | null> {
  const r = await accountApi("GET", "/v1/me/exec/shop", undefined, s);
  return r.status === 200 ? (r.body as ShopData) : null;
}

export async function execCanAdd(s: string): Promise<boolean> {
  const r = await accountApi("GET", "/v1/me/exec/can-add", undefined, s);
  return r.status === 200 && Boolean((r.body as { canAdd?: boolean }).canAdd);
}

// Rooms and VR halls (Figma 83:831).
export type RoomType = {
  id: string; name: string; kind: "vr" | "ar" | "party" | "private"; scene: "hall" | "rooftop" | "space" | "living" | "lounge"; seats: number;
  audience: "everyone" | "vip" | "adult" | "kids"; voice: boolean; spatial: boolean; avatars: boolean; live: boolean; parties: number;
};
export type RoomsData = { types: RoomType[]; vrSeats: number; parties: number; avgParty: number; canAdd: boolean; updatedBy: string; updatedAt: string | null };

export async function execRooms(s: string): Promise<RoomsData | null> {
  const r = await accountApi("GET", "/v1/me/exec/rooms", undefined, s);
  return r.status === 200 ? (r.body as RoomsData) : null;
}

// Safety and trust (Figma 82:1075).
export type SafetyCase = { showtimeId: string; messageId: number; film: string; body: string; kind: string; reason: string; reporters: number; country: string; hidden: boolean; at: string };
export type SafetyLeak = { place: string; kind: string; film: string; studio: string; traced: boolean; status: string; mins: number; at: string };
export type SafetyData = {
  reportsToday: number; settledToday: number; openReports: number; leaksDown: number; avgTakedownMin: number;
  lockouts: number; refundRepeats: number; banned: number; under13: number; queue: SafetyCase[]; leaks: SafetyLeak[];
};
export type Verdict = { label: string; pct: number }; // e.g. abusive 71

export async function execSafety(s: string): Promise<SafetyData | null> {
  const r = await accountApi("GET", "/v1/me/exec/safety", undefined, s);
  return r.status === 200 ? (r.body as SafetyData) : null;
}

const verdicts = new Map<string, Verdict>();

// Claude reads each reported chat message once and says how likely it breaks the rules; a person decides.
export async function safetyVerdicts(cases: SafetyCase[]): Promise<Record<string, Verdict>> {
  const out: Record<string, Verdict> = {};
  const todo = cases.filter((c) => c.kind === "text" && !verdicts.has(`${c.messageId}`)).slice(0, 12);
  if (todo.length && process.env.ANTHROPIC_API_KEY) {
    try {
      client ??= new Anthropic();
      const res = await client.messages.create({
        model: "claude-sonnet-5-5",
        max_tokens: 800,
        output_config: {
          effort: "low",
          format: {
            type: "json_schema",
            schema: {
              type: "object", additionalProperties: false, required: ["items"],
              properties: { items: { type: "array", items: { type: "object", additionalProperties: false, required: ["id", "label", "pct"], properties: { id: { type: "integer" }, label: { type: "string", enum: ["abusive", "hateful", "spam", "spoiler", "unsafe", "fine", "unsure"] }, pct: { type: "integer" } } } } },
            },
          },
        },
        system: "You screen reported chat messages from E-Cinema watch rooms for a human moderator. For each message, pick the one label that fits best " +
          "(abusive, hateful, spam, spoiler, unsafe, fine, unsure) and how sure you are as a whole percent from 0 to 100. Use unsure when the meaning depends on context you do not have. " +
          "The reporters' reason is a hint, not proof. Never act; a person decides.",
        messages: [{ role: "user", content: JSON.stringify(todo.map((c) => ({ id: c.messageId, film: c.film, reason: c.reason, reporters: c.reporters, message: c.body }))) }],
      }, { timeout: 45_000, maxRetries: 1 });
      const t = res.content.find((b) => b.type === "text");
      if (res.stop_reason !== "refusal" && t && t.type === "text") {
        for (const v of (JSON.parse(t.text) as { items: { id: number; label: string; pct: number }[] }).items) {
          verdicts.set(`${v.id}`, { label: v.label, pct: Math.max(0, Math.min(100, Math.round(v.pct))) });
        }
      }
    } catch { /* the queue still works without the AI hint */ }
  }
  for (const c of cases) { const v = verdicts.get(`${c.messageId}`); if (v) out[c.messageId] = v; }
  return out;
}

// Hiring and jobs (Figma 117:948).
export type HiringData = {
  open: number; openNg: number; appsQuarter: number; countries: number; hiredYear: number; hiredNg: number; daysToHire: number; ngShare: number;
  teams: { team: string; ng: number; total: number }[]; pipeline: { stage: string; ng: number; world: number }[]; byCountry: Record<string, number>;
  canPost: boolean; canQuota: boolean;
};

export async function execHiring(s: string): Promise<HiringData | null> {
  const r = await accountApi("GET", "/v1/me/exec/hiring", undefined, s);
  return r.status === 200 ? (r.body as HiringData) : null;
}

// Brand protection (Figma 117:1216).
export type BrandData = {
  month: number; prevMonth: number; confirmed: number; decided: number; takenDown: number; avgDays: number; rewardsNgn: number; rewarded: number;
  queue: { id: string; selling: string; place: string; country: string; aiNote: string; status: string; at: string }[];
  countries: Record<string, number>; online: number; total: number;
  weeks: { week: string; reports: number; confirmed: number }[]; topReporters: { name: string; confirmed: number }[];
};

export async function execBrand(s: string): Promise<BrandData | null> {
  const r = await accountApi("GET", "/v1/me/exec/brand", undefined, s);
  return r.status === 200 ? (r.body as BrandData) : null;
}

// Licensing (Figma 117:1481).
export type LicensingRow = { licence: string; name: string; country: string; plan: string; status: string; sales30Ngn: number; compliance: number };
export type LicensingData = {
  partners: number; countries: number; feesYearNgn: number; feesPrevNgn: number; royaltyNgn: number; salesNgn: number;
  byCountry: Record<string, number>; plans: Record<string, number>; rows: LicensingRow[]; applications: number;
};
export async function execLicensing(s: string): Promise<LicensingData | null> {
  const r = await accountApi("GET", "/v1/me/exec/licensing", undefined, s);
  return r.status === 200 ? (r.body as LicensingData) : null;
}

// Security operations (Figma 117:1773).
export type SecEvent = { at: string; title: string; detail: string; result: string };
export type Incident = { id: number; title: string; kind: string; severity: string; note: string; status: string; by: string; openedAt: string; closedAt: string | null };
export type SecurityData = {
  blockedToday: number; breaches: number; takeovers: number; openCritical: number; lastPenTest: string | null;
  wrongPw24h: number; locked24h: number; banned30: number; leaks30: number;
  lockdown: boolean; lockdownBy: string; lockdownAt: string | null; passkeys: number; faceChecked: number;
  events: SecEvent[]; incidents: Incident[]; canEdit: boolean;
};
export async function execSecurity(s: string): Promise<SecurityData | null> {
  const r = await accountApi("GET", "/v1/me/exec/security", undefined, s);
  return r.status === 200 ? (r.body as SecurityData) : null;
}

// Infrastructure (Figma 50:469).
export type InfraBackup = { key: string; bytes: number; tables: number; restored: boolean; finishedAt: string };
export type InfraData = {
  viewersNow: number; peakToday: number; dbPingMs: number; dbBytes: number; dbConns: number; dbMaxConns: number; dbVersion: string;
  backups: InfraBackup[]; messages24h: number; seats24h: number; p50Ms: number; p99Ms: number; requests: number;
};
export async function execInfra(s: string): Promise<InfraData | null> {
  const r = await accountApi("GET", "/v1/me/exec/infra", undefined, s);
  return r.status === 200 ? (r.body as InfraData) : null;
}

// Investor view (Figma 50:609).
export type CurAmount = { currency: string; minor: number };
export type Milestone = { id: number; quarter: string; title: string; done: boolean };
export type InvestorData = {
  months: { month: string; currency: string; net: number }[]; net30: CurAmount[]; netPrev30: CurAmount[]; gross30: CurAmount[]; studio30: CurAmount[];
  buyers30: number; members: number; paying: Record<string, number>; milestones: Milestone[]; canEdit: boolean;
};
export async function execInvestor(s: string): Promise<InvestorData | null> {
  const r = await accountApi("GET", "/v1/me/exec/investor", undefined, s);
  return r.status === 200 ? (r.body as InvestorData) : null;
}

// Stakeholder view (Figma 83:958).
export type StakeDoc = { id: string; name: string; bytes: number; sharedAt: string };
export type StakeholderData = {
  members: number; membersStart: number; revenue: CurAmount[]; revenuePrev: CurAmount[]; countries: number;
  milestones: Milestone[]; note: string; noteBy: string; noteAt: string | null; docs: StakeDoc[]; canEdit: boolean;
};
export async function execStakeholder(s: string): Promise<StakeholderData | null> {
  const r = await accountApi("GET", "/v1/me/exec/stakeholder", undefined, s);
  return r.status === 200 ? (r.body as StakeholderData) : null;
}

// Partners view (Figma 51:198).
export type Deal = { email: string; name: string; org: string; kind: string; provider: string; summary: string; plan: string[] };
export type PartnerData = {
  deal: Deal | null; deals: Deal[]; canEdit: boolean;
  stats: { paid: number; paidPrev: number; tried: number; refunded: number; volume: CurAmount[]; countries: Record<string, number> } | null;
};
export async function execPartner(s: string, as = ""): Promise<PartnerData | null> {
  const r = await accountApi("GET", `/v1/me/exec/partner${as ? `?as=${encodeURIComponent(as)}` : ""}`, undefined, s);
  return r.status === 200 ? (r.body as PartnerData) : null;
}

// 18+ recipients (Figma 49:1577, 99:1362), CEO only.
export type AdultRecipient = {
  id: string; kind: "charity" | "pastor" | "cleric"; name: string; regNumber: string; country: string; city: string;
  bank: string; accountLast: string; accountName: string; status: "pending" | "active" | "paused"; note: string; received30: CurAmount[];
};
export type RecipientsData = { recipients: AdultRecipient[]; paid30: Record<string, CurAmount[]>; unlocks30: number; access30: CurAmount[] };
export async function execRecipients(s: string): Promise<RecipientsData | null> {
  const r = await accountApi("GET", "/v1/me/exec/recipients", undefined, s);
  return r.status === 200 ? (r.body as RecipientsData) : null;
}

// Notifications and re-engagement (Figma 51:375), CEO and CMO.
export type Campaign = {
  id: number; title: string; body: string; link: string; audience: "everyone" | "lapsed" | "country"; country: string; channels: string[];
  status: "scheduled" | "sending" | "sent" | "cancelled"; sendAt: string; testSent: number; sent: number; emailed: number; opened: number; booked: number; langs: number;
};
export type CampaignsData = {
  sentToday: number; sent30: number; opened30: number; booked30: number; members: number; emailOff: number;
  campaigns: Campaign[]; automatic: { kind: string; sent: number; opened: number }[]; languages: { lang: string; members: number }[]; countryList: string[];
};
export async function execCampaigns(s: string): Promise<CampaignsData | null> {
  const r = await accountApi("GET", "/v1/me/exec/campaigns", undefined, s);
  return r.status === 200 ? (r.body as CampaignsData) : null;
}
