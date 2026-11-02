import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { accountApi } from "@/lib/auth";

// Studio AI (Figma 39:1345): answers a studio's questions from its own numbers. Every tool reads
// through the asking member's session, so Studio AI sees exactly what their role may see.

export type Turn = { role: "user" | "assistant"; text: string };
export type Chart = { title: string; bars: { label: string; value: number; note: string }[] };
export type Answer = { text: string; chart: Chart | null };

let client: Anthropic | null = null;
const LIMIT = 24_000;

const tools: Anthropic.Tool[] = [
  { name: "studio_overview", description: "The studio's money this month and last, seats, countries, completion, rating, monthly gross and its next and live screenings.", input_schema: { type: "object", properties: {} } },
  { name: "list_films", description: "Every screening the studio has: dates, seats sold, capacity, gross, studio share, rating, countries, completion and state.", input_schema: { type: "object", properties: {} } },
  {
    name: "audience_analytics",
    description: "Audience numbers over a period: viewers, hours, completion, rewatch, ratings (NPS), ages, genders, plans, watching with friends, countries with revenue, audio languages, monthly cohorts, money and seat funnel. Each comes with the previous period.",
    input_schema: { type: "object", properties: { days: { type: "integer", enum: [7, 30, 90, 365] } }, required: ["days"] },
  },
  { name: "payouts", description: "Statements and payouts to the studio. Only finance, admin and owner roles can read these.", input_schema: { type: "object", properties: {} } },
  { name: "campaigns", description: "Marketing campaign links: channel, visits (reach), orders, seats and gross they brought, and cost.", input_schema: { type: "object", properties: {} } },
  { name: "piracy_leaks", description: "Copies of the studio's films reported online, whether they were traced to a viewer, taken down, and ban requests.", input_schema: { type: "object", properties: {} } },
  { name: "uploads", description: "Films the studio uploaded: titles, loglines, genres, languages and which files are in.", input_schema: { type: "object", properties: {} } },
  { name: "dubs", description: "AI dubs and subtitles of one uploaded film, by language, with their state.", input_schema: { type: "object", properties: { uploadId: { type: "string" } }, required: ["uploadId"] } },
  {
    name: "show_chart",
    description: "Show a small bar chart under your answer. Use it once at most, only for numbers you read from the tools.",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string" },
        bars: { type: "array", maxItems: 8, items: { type: "object", properties: { label: { type: "string" }, value: { type: "number" }, note: { type: "string", description: "Short value label, like +42% or $1,200" } }, required: ["label", "value", "note"] } },
      },
      required: ["title", "bars"],
    },
  },
];

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

async function read(s: string, path: string) {
  const r = await accountApi("GET", `/v1/me/studio/${path}`, undefined, s);
  if (r.status === 403) return "This member's role cannot see this.";
  if (r.status !== 200) return `Not available (${r.status}).`;
  // Storage keys and upload ids inside files are of no use to the model.
  const text = JSON.stringify(r.body, (k, v) => (k === "key" || k === "mpId" || k === "posterKey" || k === "docsKey" || k === "checks" ? undefined : v));
  return text.length > LIMIT ? text.slice(0, LIMIT) + " …(cut)" : text;
}

async function run(s: string, name: string, input: Record<string, unknown>, chart: { c: Chart | null }): Promise<string> {
  switch (name) {
    case "studio_overview": return read(s, "overview");
    case "list_films": return read(s, "films");
    case "audience_analytics": return read(s, `analytics?days=${[7, 30, 90, 365].includes(Number(input.days)) ? Number(input.days) : 90}`);
    case "payouts": return read(s, "payouts");
    case "campaigns": return read(s, "campaigns");
    case "piracy_leaks": return read(s, "leaks");
    case "uploads": return read(s, "uploads");
    case "dubs": return ID.test(String(input.uploadId)) ? read(s, `uploads/${input.uploadId}/dubs`) : "Unknown film id; get ids from the uploads tool.";
    case "show_chart": {
      const bars = Array.isArray(input.bars) ? (input.bars as Record<string, unknown>[]).slice(0, 8).map((b) => ({ label: String(b.label ?? "").slice(0, 40), value: Number(b.value) || 0, note: String(b.note ?? "").slice(0, 24) })) : [];
      if (!bars.length) return "No bars given.";
      chart.c = { title: String(input.title ?? "").slice(0, 80), bars };
      return "Shown.";
    }
  }
  return "Unknown tool.";
}

export async function askStudio(s: string, studio: string, role: string, history: Turn[], today: string): Promise<Answer> {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("off");
  client ??= new Anthropic();
  const messages: Anthropic.MessageParam[] = history.map((t) => ({ role: t.role, content: t.text }));
  const chart: { c: Chart | null } = { c: null };
  const system =
    `You are Studio AI inside E-Cinema's studio portal, helping ${studio} (the person asking is a ${role}). Today is ${today}. ` +
    "E-Cinema premieres films online as one live screening per film, worldwide; studios get 70% of ticket revenue. " +
    "Answer from the studio's own numbers, which you read with the tools; never guess or invent a figure, viewer or person. If the data does not answer the question, say what is missing. " +
    "You can read but not change anything: if asked to schedule, dub, message or publish, say which page of the portal does it (Premieres and pricing, AI dubbing, Marketing, Team). " +
    "Reply in the language the person writes in. Keep answers short and plain: a few sentences, numbers with their currency, no tables or markdown headings.";
  for (let i = 0; i < 6; i++) {
    const res = await client.messages.create({ model: "claude-sonnet-5-5", max_tokens: 2000, system, tools, messages, output_config: { effort: "medium" } }, { timeout: 60_000, maxRetries: 1 });
    if (res.stop_reason === "refusal") return { text: "Studio AI cannot help with that one.", chart: null };
    const uses = res.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
    if (res.stop_reason !== "tool_use" || !uses.length) {
      const text = res.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map((b) => b.text).join("\n").trim();
      return { text: text || "Studio AI had nothing to say. Try asking another way.", chart: chart.c };
    }
    messages.push({ role: "assistant", content: res.content });
    const results: Anthropic.ToolResultBlockParam[] = [];
    for (const u of uses) results.push({ type: "tool_result", tool_use_id: u.id, content: await run(s, u.name, (u.input ?? {}) as Record<string, unknown>, chart) });
    messages.push({ role: "user", content: results });
  }
  return { text: "That question needed more digging than Studio AI does in one go. Try a narrower question.", chart: chart.c };
}
