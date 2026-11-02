import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { randomBytes } from "node:crypto";
import { dropUpload, dubLanguages, mediaEnabled, objectBytes, putRoomObject } from "@/lib/media";
import { langName } from "@/lib/i18n";

// AI dubbing (Figma 35:871). The studio's subtitle file is the script: Claude translates it
// line by line and flags what a person should check, ElevenLabs voices each approved line,
// and an approved language becomes a track in the watch room for the film's showtime.

type File = { kind: string; name: string; key: string; status: string; size: number };
type Job = { upload: string; title: string; lang: string; status: "translating" | "voicing"; files: File[]; showtimeId: string | null };
export type Line = { idx: number; startMs: number; endMs: number; speaker: string; source: string; text: string; flag: string; audioKey: string };
type Cue = { startMs: number; endMs: number; speaker: string; source: string };

const MAX_SUBTITLE_BYTES = 4 << 20;
const MAX_CUES = 5000;
const CHUNK = 120;
const busy = new Set<string>();
let client: Anthropic | null = null;

async function api<T>(method: string, path: string, body?: unknown): Promise<{ status: number; body: T }> {
  const r = await fetch(`${process.env.API_URL}${path}`, {
    method,
    headers: { Authorization: `Bearer ${process.env.INTERNAL_API_TOKEN}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
    cache: "no-store",
  });
  return { status: r.status, body: (await r.json().catch(() => ({}))) as T };
}

export const dubWorkerReady = () => Boolean(process.env.API_URL && process.env.INTERNAL_API_TOKEN && mediaEnabled);

// --- Subtitle files ---

function ms(t: string): number {
  const m = t.trim().match(/^(?:(\d+):)?(\d{1,2}):(\d{2})[.,](\d{1,3})$/);
  if (!m) return NaN;
  return ((Number(m[1] ?? 0) * 60 + Number(m[2])) * 60 + Number(m[3])) * 1000 + Number(m[4].padEnd(3, "0"));
}

function clean(raw: string): { speaker: string; text: string } {
  let speaker = "";
  const v = raw.match(/<v(?:\.[^ >]+)?\s+([^>]{1,40})>/);
  if (v) speaker = v[1].trim();
  let text = raw.replace(/\{\\[^}]*\}/g, "").replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ");
  text = text.split("\n").map((l) => l.trim()).filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
  const named = !speaker && text.match(/^([A-Z][A-Za-z0-9 .'-]{0,30}):\s+(.+)$/);
  if (named) {
    speaker = named[1].trim();
    text = named[2];
  }
  return { speaker: speaker.slice(0, 40), text: text.slice(0, 600) };
}

// SRT, WebVTT and TTML, the three formats the upload page accepts.
export function parseSubtitles(src: string, name: string): Cue[] {
  const out: Cue[] = [];
  src = src.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  if (/\.ttml$|\.dfxp$|\.xml$/i.test(name) || /^\s*<\?xml|<tt[\s>]/.test(src)) {
    const time = (t: string) => (/^\d+(\.\d+)?s$/.test(t) ? Math.round(parseFloat(t) * 1000) : ms(t.replace(/^(\d+:\d+:\d+):(\d+)$/, "$1.$2")));
    for (const m of src.matchAll(/<p\b([^>]*)>([\s\S]*?)<\/p>/g)) {
      const b = m[1].match(/begin="([^"]+)"/)?.[1], e = m[1].match(/end="([^"]+)"/)?.[1];
      if (!b || !e) continue;
      const c = clean(m[2].replace(/<br\s*\/?>/g, "\n"));
      const startMs = time(b), endMs = time(e);
      if (c.text && Number.isFinite(startMs) && Number.isFinite(endMs) && endMs >= startMs) out.push({ startMs, endMs, speaker: c.speaker, source: c.text });
    }
    return out.slice(0, MAX_CUES);
  }
  for (const block of src.split(/\n{2,}/)) {
    const lines = block.split("\n");
    const at = lines.findIndex((l) => l.includes("-->"));
    if (at < 0) continue;
    const [a, b] = lines[at].split("-->");
    const startMs = ms(a), endMs = ms(b.trim().split(/\s+/)[0]);
    const c = clean(lines.slice(at + 1).join("\n"));
    if (c.text && Number.isFinite(startMs) && Number.isFinite(endMs) && endMs >= startMs) out.push({ startMs, endMs, speaker: c.speaker, source: c.text });
    if (out.length >= MAX_CUES) break;
  }
  return out;
}

// --- Translation ---

async function translateChunk(title: string, lang: string, cues: Cue[], offset: number, before: string[]): Promise<{ i: number; text: string; flag: string }[]> {
  client ??= new Anthropic();
  const res = await client.messages.create({
    model: "claude-sonnet-5-5",
    max_tokens: 16000,
    output_config: {
      effort: "low",
      format: {
        type: "json_schema",
        schema: {
          type: "object", additionalProperties: false, required: ["lines"],
          properties: {
            lines: {
              type: "array",
              items: {
                type: "object", additionalProperties: false, required: ["i", "text", "flag"],
                properties: {
                  i: { type: "integer", description: "The line number from the input" },
                  text: { type: "string", description: "The line translated for speaking aloud" },
                  flag: { type: "string", description: "Empty when the line is fine. Otherwise under 80 characters saying what a person should check, such as an idiom, a pun, a name, a cultural reference or a line too long for its time" },
                },
              },
            },
          },
        },
      },
    },
    system: `You translate film dialogue into ${langName(lang)} (${lang}) for an AI voice dub. Write natural spoken ${langName(lang)} that an actor could say in the time each line is on screen; keep names, keep the speaker's tone and register, and keep it about as long as the original. Translate every line you are given, one output per input line, with the same i. Flag only lines a native-speaking reviewer should look at, and say why in a few plain words. Never add lines or commentary.`,
    messages: [{
      role: "user",
      content: JSON.stringify({
        film: title,
        earlierLines: before,
        lines: cues.map((c, k) => ({ i: offset + k, speaker: c.speaker || undefined, seconds: Math.round((c.endMs - c.startMs) / 100) / 10, text: c.source })),
      }),
    }],
  }, { timeout: 240_000, maxRetries: 2 });
  if (res.stop_reason === "refusal") throw new Error("The translation was refused for part of the script");
  if (res.stop_reason === "max_tokens") throw new Error("Part of the script was too long to translate in one go");
  const t = res.content.find((b) => b.type === "text");
  if (!t || t.type !== "text") throw new Error("The translation came back empty");
  return (JSON.parse(t.text) as { lines: { i: number; text: string; flag: string }[] }).lines;
}

// About 17 characters a second is as fast as dialogue can comfortably be spoken.
function tooLong(text: string, c: { startMs: number; endMs: number }) {
  const sec = Math.max(0.5, (c.endMs - c.startMs) / 1000);
  return text.length / sec > 20 && text.length > 12;
}

async function translate(job: Job) {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("AI translation is not switched on yet");
  const sub = job.files.find((f) => f.kind === "subtitles" && f.status === "uploaded");
  if (!sub) throw new Error("Upload a subtitle file first");
  if (sub.size > MAX_SUBTITLE_BYTES) throw new Error("The subtitle file is larger than 4 MB");
  const obj = await objectBytes(sub.key);
  if (!obj) throw new Error("The subtitle file is missing from storage. Upload it again");
  const cues = parseSubtitles(obj.body.toString("utf8"), sub.name);
  if (!cues.length) throw new Error(`No timed lines were found in ${sub.name}`);
  const chunks: { at: number; cues: Cue[] }[] = [];
  for (let at = 0; at < cues.length; at += CHUNK) chunks.push({ at, cues: cues.slice(at, at + CHUNK) });
  const done = new Map<number, { text: string; flag: string }>();
  for (let k = 0; k < chunks.length; k += 3) {
    await Promise.all(chunks.slice(k, k + 3).map(async (ch) => {
      const before = cues.slice(Math.max(0, ch.at - 4), ch.at).map((c) => c.source);
      for (const l of await translateChunk(job.title, job.lang, ch.cues, ch.at, before)) {
        if (Number.isInteger(l.i) && l.i >= ch.at && l.i < ch.at + ch.cues.length && l.text.trim()) done.set(l.i, { text: l.text.trim(), flag: l.flag.trim() });
      }
    }));
  }
  const lines = cues.map((c, i) => {
    const d = done.get(i);
    let flag = d?.flag ?? "Not translated; write this line";
    const text = d?.text ?? c.source;
    if (!flag && tooLong(text, c)) flag = "Longer than the scene allows; shorten it";
    return { startMs: c.startMs, endMs: c.endMs, speaker: c.speaker, source: c.source, text, flag: flag.slice(0, 120) };
  });
  const r = await api("PUT", `/v1/studio-dubs/${job.upload}/${job.lang}/lines`, { lines });
  if (r.status !== 200 && r.status !== 404) throw new Error(`Saving the translation failed (${r.status})`);
}

// "Regenerate line": a fresh take on one line, using the reviewer's flag as the brief.
export async function regenerateLine(title: string, lang: string, line: Line, around: string[]): Promise<{ text: string; flag: string }> {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("off");
  client ??= new Anthropic();
  const res = await client.messages.create({
    model: "claude-sonnet-5-5",
    max_tokens: 1500,
    output_config: {
      effort: "low",
      format: {
        type: "json_schema",
        schema: {
          type: "object", additionalProperties: false, required: ["text", "flag"],
          properties: { text: { type: "string" }, flag: { type: "string", description: "Empty when the new line is fine, else under 80 characters on what still needs a person" } },
        },
      },
    },
    system: `You rewrite one line of a ${langName(lang)} (${lang}) film dub so an actor can say it naturally in the time it is on screen. Fix what the reviewer's note says. Answer with the new line only.`,
    messages: [{ role: "user", content: JSON.stringify({ film: title, speaker: line.speaker || undefined, seconds: Math.round((line.endMs - line.startMs) / 100) / 10, original: line.source, currentTranslation: line.text, reviewerNote: line.flag || "Make it sound more natural", nearbyLines: around }) }],
  }, { timeout: 60_000, maxRetries: 1 });
  const t = res.content.find((b) => b.type === "text");
  if (res.stop_reason === "refusal" || !t || t.type !== "text") throw new Error("empty");
  const out = JSON.parse(t.text) as { text: string; flag: string };
  let flag = out.flag.trim().slice(0, 120);
  if (!flag && tooLong(out.text, line)) flag = "Longer than the scene allows; shorten it";
  return { text: out.text.trim().slice(0, 600), flag };
}

// --- Voicing ---

const ELEVEN = () => process.env.ELEVENLABS_API_BASE ?? "https://api.elevenlabs.io";

async function voices(): Promise<string[]> {
  const res = await fetch(`${ELEVEN()}/v1/voices`, { headers: { "xi-api-key": process.env.ELEVENLABS_API_KEY! }, signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`The voice service refused the request (${res.status})`);
  const { voices: list } = (await res.json()) as { voices: { voice_id: string; category?: string }[] };
  const ids = list.filter((v) => v.category === "premade").map((v) => v.voice_id);
  if (!ids.length && list[0]) ids.push(list[0].voice_id);
  if (!ids.length) throw new Error("No voices are available on the voice service");
  const first = process.env.ELEVENLABS_VOICE_ID;
  return first ? [first, ...ids.filter((i) => i !== first)] : ids;
}

async function speak(voiceId: string, text: string, previous?: string, next?: string): Promise<Buffer> {
  const res = await fetch(`${ELEVEN()}/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_128`, {
    method: "POST",
    headers: { "xi-api-key": process.env.ELEVENLABS_API_KEY!, "content-type": "application/json", accept: "audio/mpeg" },
    body: JSON.stringify({ text, model_id: "eleven_multilingual_v2", previous_text: previous, next_text: next }),
    signal: AbortSignal.timeout(60_000),
  });
  if (res.status === 401 || res.status === 402 || res.status === 429) throw new Error(res.status === 429 ? "The voice service is busy. Try again in a few minutes" : "The voice service account needs attention (credits or key)");
  if (!res.ok) throw new Error(`The voice service failed on a line (${res.status})`);
  return Buffer.from(await res.arrayBuffer());
}

async function voice(job: Job) {
  if (!process.env.ELEVENLABS_API_KEY) throw new Error("AI voices are not switched on yet");
  const r = await api<{ lines: Line[] }>("GET", `/v1/studio-dubs/${job.upload}/${job.lang}`);
  if (r.status !== 200) throw new Error(`Reading the script failed (${r.status})`);
  const lines = r.body.lines ?? [];
  const ids = await voices();
  // The same speaker keeps the same voice; unnamed lines use the first voice.
  const cast = new Map<string, string>();
  for (const l of lines) if (l.speaker && !cast.has(l.speaker)) cast.set(l.speaker, ids[(cast.size + 1) % ids.length]);
  const todo = lines.filter((l) => !l.audioKey && l.text.trim());
  for (let k = 0; k < todo.length; k += 3) {
    await Promise.all(todo.slice(k, k + 3).map(async (l) => {
      const audio = await speak(cast.get(l.speaker) ?? ids[0], l.text, lines[l.idx - 1]?.text, lines[l.idx + 1]?.text);
      const key = `studio-dubs/${job.upload}/${job.lang}/${l.idx}-${randomBytes(4).toString("hex")}.mp3`;
      await putRoomObject(key, audio, "audio/mpeg");
      // 404 means the line changed while it was being voiced; it is voiced again next time.
      const put = await api("PUT", `/v1/studio-dubs/${job.upload}/${job.lang}/lines/${l.idx}`, { text: l.text, audioKey: key });
      if (put.status !== 200 && put.status !== 404) throw new Error(`Saving a voiced line failed (${put.status})`);
    }));
  }
}

// --- The player's tracks ---

// Writes dubs/<showtime>/<lang>/manifest.json for every approved language, which is what the
// watch room reads. Runs when a language is approved and when the film is published.
export async function syncDubs(upload: string) {
  if (!dubWorkerReady()) return;
  const r = await api<{ showtimeId: string; langs: string[] }>("GET", `/v1/studio-dubs/${upload}`);
  if (r.status !== 200 || !r.body.showtimeId) return;
  const sid = r.body.showtimeId, approved = new Set(r.body.langs ?? []);
  // A language that was removed or sent back to review stops playing in the room.
  for (const lang of await dubLanguages(sid).catch(() => [])) {
    if (!approved.has(lang)) await dropUpload(`dubs/${sid}/${lang}/manifest.json`, "", true);
  }
  for (const lang of approved) {
    const l = await api<{ lines: Line[] }>("GET", `/v1/studio-dubs/${upload}/${lang}`);
    if (l.status !== 200) continue;
    const clips = (l.body.lines ?? []).filter((x) => x.audioKey).map((x) => ({ start: x.startMs / 1000, end: x.endMs / 1000, key: x.audioKey, text: x.text }));
    if (!clips.length) continue;
    await putRoomObject(`dubs/${sid}/${lang}/manifest.json`, Buffer.from(JSON.stringify({ film: sid, lang, source: "studio", clips })), "application/json");
  }
}

// --- Running jobs ---

function plain(e: unknown) {
  const m = e instanceof Error ? e.message : String(e);
  // Only our own sentences reach the studio; anything else is logged and summarised.
  return /^[A-Z][^\n]{0,200}$/.test(m) && !/key|token|https?:/i.test(m) ? m : "Something went wrong. Try again";
}

async function run(job: Job) {
  const id = `${job.upload}/${job.lang}`;
  if (busy.has(id)) return;
  busy.add(id);
  try {
    if (job.status === "translating") await translate(job);
    else await voice(job);
    await api("POST", `/v1/studio-dubs/${job.upload}/${job.lang}/finish`, { error: "" });
  } catch (e) {
    console.error("dub", id, job.status, e instanceof Error ? e.message : e);
    await api("POST", `/v1/studio-dubs/${job.upload}/${job.lang}/finish`, { error: plain(e) }).catch(() => {});
  } finally {
    busy.delete(id);
  }
}

let sweeping = false;
export async function sweepDubs() {
  if (!dubWorkerReady() || sweeping) return;
  sweeping = true;
  try {
    const r = await api<{ jobs: Job[] }>("GET", "/v1/studio-dubs/work");
    if (r.status !== 200) return;
    // A few languages at a time; the rest wait for the next sweep.
    const free = Math.max(0, 3 - busy.size);
    for (const j of (r.body.jobs ?? []).filter((x) => !busy.has(`${x.upload}/${x.lang}`)).slice(0, free)) void run(j);
  } catch (e) {
    console.error("dub sweep", e instanceof Error ? e.message : e);
  } finally {
    sweeping = false;
  }
}

export function startDubWorker() {
  setTimeout(() => void sweepDubs(), 5_000).unref?.();
  setInterval(() => void sweepDubs(), 30_000).unref?.();
}
