// AI dubbing: translate the subtitles, then voice every line with ElevenLabs, one language per instance.
// Output in R2: dubs/<film>/<lang>/<n>.mp3 plus manifest.json that the player uses to line clips up with the film.
import { type TaskContext, task } from "@renderinc/sdk/workflows";
import { speak, pickVoice } from "./elevenlabs.js";
import { put } from "./storage.js";
import { translateTrack } from "./subtitles.js";
import { parseVtt } from "./vtt.js";

const FILM = /^[a-z0-9-]{1,80}$/;
const LANG = /^[a-z]{2,3}(-[A-Z]{2})?$/;

async function inBatches<T, R>(items: T[], size: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(...(await Promise.all(items.slice(i, i + size).map((it, j) => fn(it, i + j)))));
  }
  return out;
}

export const voiceTrack = task(
  {
    name: "voiceTrack",
    timeoutSeconds: 14_400,
    plan: "starter",
    retry: { maxRetries: 2, waitDurationMs: 15_000, backoffScaling: 2 },
  },
  async function voiceTrack(_ctx: TaskContext, filmId: string, language: string, vtt: string, voiceId?: string) {
    if (!FILM.test(filmId) || !LANG.test(language)) throw new Error("invalid film id or language");
    const cues = parseVtt(vtt);
    if (cues.length === 0) throw new Error("no cues to voice");
    const voice = await pickVoice(voiceId);
    const prefix = `dubs/${filmId}/${language}`;
    const clips = await inBatches(cues, 3, async (cue, i) => {
      const audio = await speak({
        voiceId: voice,
        text: cue.text,
        previousText: cues[i - 1]?.text,
        nextText: cues[i + 1]?.text,
      });
      const key = await put(`${prefix}/${String(i).padStart(5, "0")}.mp3`, audio, "audio/mpeg");
      return { start: cue.start, end: cue.end, key, text: cue.text };
    });
    const manifest = { filmId, language, voiceId: voice, createdAt: new Date().toISOString(), clips };
    await put(`${prefix}/manifest.json`, JSON.stringify(manifest), "application/json");
    await put(`${prefix}/subtitles.vtt`, vtt, "text/vtt");
    console.log(`${filmId}/${language}: voiced ${clips.length} lines`);
    return { language, lines: clips.length, manifest: `${prefix}/manifest.json` };
  },
);

export const dubFilm = task(
  { name: "dubFilm", timeoutSeconds: 21_600, plan: "starter" },
  async function dubFilm(ctx: TaskContext, filmId: string, vtt: string, languages: string[], voiceId?: string) {
    if (!FILM.test(filmId)) throw new Error("invalid film id");
    if (typeof vtt !== "string" || !vtt.startsWith("WEBVTT") || vtt.length > 200_000) {
      throw new Error("expected a WebVTT file under 200 KB");
    }
    const langs = [...new Set(languages)].filter((l) => LANG.test(l)).slice(0, 40);
    if (langs.length === 0) throw new Error("no valid languages");
    // Each language is translated and voiced on its own instance, all at the same time.
    const results = await Promise.allSettled(
      langs.map(async (lang) => {
        const { vtt: translated } = await ctx.run(translateTrack, vtt, lang);
        return ctx.run(voiceTrack, filmId, lang, translated, voiceId);
      }),
    );
    return {
      filmId,
      dubbed: results.flatMap((r) => (r.status === "fulfilled" ? [r.value] : [])),
      failed: results.flatMap((r, i) => (r.status === "rejected" ? [langs[i]] : [])),
    };
  },
);
