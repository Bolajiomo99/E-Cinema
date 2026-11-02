import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { parseSubtitles } from "@/lib/dub-worker";
import { objectBytes } from "@/lib/media";
import type { UploadFile } from "@/lib/studio-types";

// "AI clip generator" (Figma 39:779): Studio AI reads the film's timed dialogue and picks the
// strongest short moments before the spoiler cutoff, each with a title and a frame shape.

export type ClipPick = { startMs: number; endMs: number; title: string; why: string; format: "9:16" | "1:1" | "16:9" };

let client: Anthropic | null = null;
const stamp = (ms: number) => { const s = Math.floor(ms / 1000); return `${Math.floor(s / 3600)}:${String(Math.floor(s / 60) % 60).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`; };

export async function pickClips(title: string, logline: string, files: UploadFile[], cutoffMs: number): Promise<ClipPick[]> {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("off");
  const sub = files.find((f) => f.kind === "subtitles" && f.status === "uploaded");
  if (!sub) throw new Error("Upload the film's subtitle file first; Studio AI picks moments from the dialogue.");
  if (sub.size > 4 << 20) throw new Error("The subtitle file is larger than 4 MB");
  const obj = await objectBytes(sub.key);
  if (!obj) throw new Error("The subtitle file is missing from storage. Upload it again.");
  const cues = parseSubtitles(obj.body.toString("utf8"), sub.name).filter((c) => c.endMs <= cutoffMs);
  if (cues.length < 5) throw new Error("There is not enough dialogue before the spoiler cutoff to pick from. Move the cutoff later.");
  const script = cues.slice(0, 1500).map((c) => `${c.startMs}-${c.endMs} ${c.speaker ? c.speaker + ": " : ""}${c.source.replace(/\n/g, " ")}`).join("\n");
  client ??= new Anthropic();
  const res = await client.messages.create({
    model: "claude-sonnet-5-5",
    max_tokens: 3000,
    output_config: {
      effort: "medium",
      format: {
        type: "json_schema",
        schema: {
          type: "object", additionalProperties: false, required: ["clips"],
          properties: {
            clips: {
              type: "array",
              items: {
                type: "object", additionalProperties: false, required: ["startMs", "endMs", "title", "why", "format"],
                properties: {
                  startMs: { type: "integer" }, endMs: { type: "integer" },
                  title: { type: "string", description: "Two or three words for the clip's card, like FIRST DRAW" },
                  why: { type: "string", description: "One short sentence on why this moment works as a clip" },
                  format: { type: "string", enum: ["9:16", "1:1", "16:9"] },
                },
              },
            },
          },
        },
      },
    },
    system: "You cut social clips for a film studio from its timed dialogue (milliseconds). Pick up to 8 self-contained moments, 10 to 30 seconds each, that make people want to buy a ticket: hooks, strong lines, tension, humour. " +
      "Never reveal twists or the ending; use only lines given (they all come before the spoiler cutoff). Start and end on dialogue boundaries from the list. Prefer 9:16 for short punchy moments, 1:1 for dialogue, 16:9 for wide action. No two clips may overlap.",
    messages: [{ role: "user", content: `Film: ${title}\nLogline: ${logline || "(none)"}\nSpoiler cutoff: ${stamp(cutoffMs)}\n\n${script}` }],
  }, { timeout: 90_000, maxRetries: 1 });
  const t = res.content.find((b) => b.type === "text");
  if (res.stop_reason === "refusal" || !t || t.type !== "text") throw new Error("Studio AI could not pick moments from this film.");
  const out = (JSON.parse(t.text) as { clips: ClipPick[] }).clips;
  // Keep only clean, non-overlapping picks inside the rules the API enforces.
  const picks: ClipPick[] = [];
  for (const c of out.sort((a, b) => a.startMs - b.startMs)) {
    const startMs = Math.max(0, Math.round(c.startMs)), endMs = Math.min(Math.round(c.endMs), cutoffMs, startMs + 60_000);
    if (endMs - startMs < 3000 || picks.some((p) => startMs < p.endMs && endMs > p.startMs)) continue;
    picks.push({ startMs, endMs, title: c.title.trim().slice(0, 40) || "Moment", why: c.why.trim().slice(0, 200), format: ["9:16", "1:1", "16:9"].includes(c.format) ? c.format : "9:16" });
    if (picks.length === 8) break;
  }
  return picks;
}
