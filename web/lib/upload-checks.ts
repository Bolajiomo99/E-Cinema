import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import type { UploadCheck, UploadFile } from "@/lib/studio-types";

// Reads a studio's uploaded file from storage, a few bytes at a time, and says what it is:
// the container, picture size, codec, frame rate, HDR and running time of a QuickTime or MP4
// master; channels and sample rate of audio stems; and line count, timing order and an age
// rating suggestion from subtitles. Nothing is guessed: what we cannot read yet says "Soon".

export type Read = (start: number, end: number) => Promise<Buffer>;
export type Inspection = { status: "uploaded" | "failed"; info: string; checks: UploadCheck[]; durationSec?: number };

const CODECS: Record<string, string> = {
  ap4h: "ProRes 4444", ap4x: "ProRes 4444 XQ", apch: "ProRes 422 HQ", apcn: "ProRes 422", apcs: "ProRes 422 LT", apco: "ProRes 422 Proxy",
  avc1: "H.264", avc3: "H.264", hvc1: "HEVC", hev1: "HEVC", dvh1: "Dolby Vision", dvhe: "Dolby Vision", av01: "AV1",
  AVdh: "DNxHR", AVdn: "DNxHD", mp4v: "MPEG-4",
};

export function runtime(sec: number) {
  const h = Math.floor(sec / 3600), m = Math.round((sec % 3600) / 60);
  return h ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}m ${String(Math.round(sec % 60)).padStart(2, "0")}s`;
}

function clock(sec: number) {
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = Math.floor(sec % 60);
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function resolution(w: number, h: number) {
  if (w >= 3800) return "4K";
  if (w >= 2500) return "2.5K";
  if (w >= 1900) return "1080p";
  if (w >= 1200) return "720p";
  return `${Math.round(h)}p`;
}

type Box = { type: string; start: number; end: number };

// The child boxes inside [start, end) of an ISO media buffer.
function boxes(b: Buffer, start: number, end: number): Box[] {
  const out: Box[] = [];
  let o = start;
  while (o + 8 <= end && out.length < 500) {
    let len = b.readUInt32BE(o);
    const type = b.toString("latin1", o + 4, o + 8);
    let head = 8;
    if (len === 1 && o + 16 <= end) { len = Number(b.readBigUInt64BE(o + 8)); head = 16; }
    if (len === 0) len = end - o;
    if (len < head || o + len > end) break;
    out.push({ type, start: o + head, end: o + len });
    o += len;
  }
  return out;
}
const child = (b: Buffer, box: Box | undefined, type: string) => (box ? boxes(b, box.start, box.end).find((x) => x.type === type) : undefined);

export type Movie = { durationSec: number; width: number; height: number; codec: string; fps: number; hdr: string; audioTracks: number; brand: string };

// Finds and parses the "moov" box of a QuickTime or MP4 file. Cameras and editors often
// write it at the end, so we walk the top-level boxes by their headers.
export async function readMovie(read: Read, size: number): Promise<Movie | null> {
  let o = 0, brand = "";
  let moov: { start: number; len: number } | null = null;
  for (let i = 0; i < 64 && o + 8 <= size; i++) {
    const h = await read(o, Math.min(size - 1, o + 15));
    if (h.length < 8) break;
    let len = h.readUInt32BE(0);
    const type = h.toString("latin1", 4, 8);
    if (!/^[a-zA-Z0-9 ©]{4}$/.test(type)) return null;
    if (len === 1) len = Number(h.readBigUInt64BE(8));
    if (len === 0) len = size - o;
    if (len < 8) return null;
    if (type === "ftyp" && h.length >= 12) brand = h.toString("latin1", 8, 12);
    if (type === "moov") { moov = { start: o, len }; break; }
    o += len;
  }
  if (!moov || moov.len > 64 * 1024 * 1024) return null;
  const b = await read(moov.start, moov.start + moov.len - 1);
  const root = boxes(b, 0, b.length).find((x) => x.type === "moov");
  if (!root) return null;
  const m: Movie = { durationSec: 0, width: 0, height: 0, codec: "", fps: 0, hdr: "", audioTracks: 0, brand };
  const mvhd = child(b, root, "mvhd");
  if (mvhd) {
    const v1 = b[mvhd.start] === 1;
    const scale = b.readUInt32BE(mvhd.start + (v1 ? 20 : 12));
    const dur = v1 ? Number(b.readBigUInt64BE(mvhd.start + 24)) : b.readUInt32BE(mvhd.start + 16);
    if (scale) m.durationSec = dur / scale;
  }
  for (const trak of boxes(b, root.start, root.end).filter((x) => x.type === "trak")) {
    const mdia = child(b, trak, "mdia");
    const hdlr = child(b, mdia, "hdlr");
    const kind = hdlr ? b.toString("latin1", hdlr.start + 8, hdlr.start + 12) : "";
    if (kind === "soun") { m.audioTracks++; continue; }
    if (kind !== "vide" || m.width) continue;
    const tkhd = child(b, trak, "tkhd");
    if (tkhd) { m.width = b.readUInt32BE(tkhd.end - 8) / 65536; m.height = b.readUInt32BE(tkhd.end - 4) / 65536; }
    const mdhd = child(b, mdia, "mdhd");
    const scale = mdhd ? b.readUInt32BE(mdhd.start + (b[mdhd.start] === 1 ? 20 : 12)) : 0;
    const stbl = child(b, child(b, mdia, "minf"), "stbl");
    const stts = child(b, stbl, "stts");
    if (stts && scale && b.readUInt32BE(stts.start + 4) > 0) {
      const delta = b.readUInt32BE(stts.start + 12);
      if (delta) m.fps = Math.round((scale / delta) * 100) / 100;
    }
    const stsd = child(b, stbl, "stsd");
    if (stsd && b.readUInt32BE(stsd.start + 4) > 0) {
      const entry = stsd.start + 8;
      const fourcc = b.toString("latin1", entry + 4, entry + 8);
      m.codec = CODECS[fourcc] ?? fourcc.trim();
      const len = b.readUInt32BE(entry);
      // Visual sample entries carry 78 bytes of fixed fields before their child boxes.
      for (const x of boxes(b, entry + 86, Math.min(stsd.end, entry + len))) {
        if (x.type === "colr" && x.end - x.start >= 10) {
          const transfer = b.readUInt16BE(x.start + 6);
          if (transfer === 16) m.hdr = "HDR10";
          else if (transfer === 18) m.hdr = "HLG";
        }
      }
    }
  }
  return m;
}

export type Audio = { format: string; channels: number; rate: number; bits: number; durationSec: number };

export function readAudio(h: Buffer, size: number): Audio | null {
  const tag = h.toString("latin1", 0, 4);
  if ((tag === "RIFF" || tag === "RF64" || tag === "BW64") && h.toString("latin1", 8, 12) === "WAVE") {
    for (const c of boxesLE(h, 12)) {
      if (c.type === "fmt " && c.end - c.start >= 16) {
        const channels = h.readUInt16LE(c.start + 2), rate = h.readUInt32LE(c.start + 4), byteRate = h.readUInt32LE(c.start + 8), bits = h.readUInt16LE(c.start + 14);
        return { format: "WAV", channels, rate, bits, durationSec: byteRate ? size / byteRate : 0 };
      }
    }
    return null;
  }
  if (tag === "FORM" && /^AIF[FC]$/.test(h.toString("latin1", 8, 12))) {
    let o = 12;
    while (o + 8 <= h.length) {
      const type = h.toString("latin1", o, o + 4), len = h.readUInt32BE(o + 4);
      if (type === "COMM" && o + 26 <= h.length) {
        const channels = h.readInt16BE(o + 8), frames = h.readUInt32BE(o + 10), bits = h.readInt16BE(o + 14);
        const exp = h.readUInt16BE(o + 16) & 0x7fff, mant = h.readUInt32BE(o + 18);
        const rate = Math.round(mant * Math.pow(2, exp - 16383 - 31));
        return { format: "AIFF", channels, rate, bits, durationSec: rate ? frames / rate : 0 };
      }
      o += 8 + len + (len % 2);
    }
    return null;
  }
  if (tag === "fLaC" && h.length >= 26) {
    const rate = (h[18] << 12) | (h[19] << 4) | (h[20] >> 4);
    const channels = ((h[20] >> 1) & 7) + 1;
    const bits = (((h[20] & 1) << 4) | (h[21] >> 4)) + 1;
    const samples = (h[21] & 0x0f) * 2 ** 32 + h.readUInt32BE(22);
    return { format: "FLAC", channels, rate, bits, durationSec: rate ? samples / rate : 0 };
  }
  return null;
}

function boxesLE(h: Buffer, start: number): Box[] {
  const out: Box[] = [];
  let o = start;
  while (o + 8 <= h.length && out.length < 64) {
    const len = h.readUInt32LE(o + 4);
    out.push({ type: h.toString("latin1", o, o + 4), start: o + 8, end: Math.min(h.length, o + 8 + len) });
    o += 8 + len + (len % 2);
  }
  return out;
}

export type Subtitles = { cues: number; outOfOrder: number; overlaps: number; lastEndSec: number; text: string };

const TIME = /(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})/;
const toSec = (m: RegExpExecArray) => +m[1] * 3600 + +m[2] * 60 + +m[3] + +m[4].padEnd(3, "0") / 1000;

export function readSubtitles(raw: string): Subtitles {
  const s = raw.replace(/^﻿/, "").replace(/\r/g, "");
  const cues: { a: number; b: number; text: string }[] = [];
  if (/<tt[\s>]/.test(s)) {
    for (const m of s.matchAll(/<p\b([^>]*)>([\s\S]*?)<\/p>/g)) {
      const a = /begin="([^"]+)"/.exec(m[1]), b = /end="([^"]+)"/.exec(m[1]);
      const ta = a && TIME.exec(a[1].replace(/\.(\d+)$/, ",$1")), tb = b && TIME.exec(b[1].replace(/\.(\d+)$/, ",$1"));
      cues.push({ a: ta ? toSec(ta) : 0, b: tb ? toSec(tb) : 0, text: m[2].replace(/<[^>]+>/g, " ") });
    }
  } else {
    for (const block of s.split(/\n{2,}/)) {
      const lines = block.split("\n");
      const i = lines.findIndex((l) => l.includes("-->"));
      if (i < 0) continue;
      const [l, r] = lines[i].split("-->");
      const a = TIME.exec(l.length > 8 ? l : `00:${l}`), b = TIME.exec(r);
      if (!a || !b) continue;
      cues.push({ a: toSec(a), b: toSec(b), text: lines.slice(i + 1).join(" ").replace(/<[^>]+>/g, "") });
    }
  }
  let outOfOrder = 0, overlaps = 0;
  for (let i = 0; i < cues.length; i++) {
    if (cues[i].b < cues[i].a) outOfOrder++;
    if (i && cues[i].a < cues[i - 1].a) outOfOrder++;
    else if (i && cues[i].a < cues[i - 1].b - 0.05) overlaps++;
  }
  return { cues: cues.length, outOfOrder, overlaps, lastEndSec: cues.reduce((m, c) => Math.max(m, c.b), 0), text: cues.map((c) => c.text.trim()).join("\n") };
}

let client: Anthropic | undefined;

// Claude reads the dialogue and suggests an age rating, with the reasons a parent would want.
async function rateDialogue(text: string): Promise<{ rating: string; reasons: string[]; language: string } | null> {
  if (!process.env.ANTHROPIC_API_KEY || text.length < 200) return null;
  client ??= new Anthropic();
  const res = await client.messages.create({
    model: "claude-opus-5-5",
    max_tokens: 400,
    output_config: {
      effort: "low",
      format: {
        type: "json_schema",
        schema: {
          type: "object", additionalProperties: false, required: ["rating", "reasons", "language"],
          properties: {
            rating: { type: "string", enum: ["All ages", "7+", "13+", "16+", "18+"] },
            reasons: { type: "array", items: { type: "string", description: "One or two words, such as violence or strong language" }, maxItems: 4 },
            language: { type: "string", description: "The language of the dialogue in English, such as Yoruba" },
          },
        },
      },
    },
    system: "You suggest an age rating for a film from its subtitles, for the studio to confirm. Judge only what the dialogue shows: violence, strong language, sex, drugs, frightening scenes. Be conservative.",
    messages: [{ role: "user", content: text.slice(0, 60_000) }],
  }, { timeout: 60_000, maxRetries: 1 });
  if (res.stop_reason === "refusal") return null;
  const t = res.content.find((b) => b.type === "text");
  return t && t.type === "text" ? JSON.parse(t.text) : null;
}

const LATER: UploadCheck = { state: "soon", text: "Sync, loudness, burnt-in subtitle and dark-scene checks" };

export async function inspect(f: UploadFile, read: Read): Promise<Inspection> {
  const head = await read(0, Math.min(f.size - 1, 64 * 1024 - 1));
  const size = `${f.size >= 1e12 ? (f.size / 1e12).toFixed(2) + " TB" : f.size >= 1e9 ? (f.size / 1e9).toFixed(1) + " GB" : Math.max(1, Math.round(f.size / 1e6)) + " MB"}`;
  const ext = f.name.toLowerCase().split(".").pop() ?? "";
  const bad = (what: string): Inspection => ({ status: "failed", info: `${size} · this is not a ${what} file`, checks: [{ state: "warn", text: `${f.name} is not a real ${what} file. Export it again and upload it.` }] });

  if (["mov", "mp4", "m4v"].includes(ext)) {
    const isoTag = head.toString("latin1", 4, 8);
    if (!["ftyp", "moov", "mdat", "wide", "free", "skip", "pnot"].includes(isoTag)) return bad(ext === "mov" ? "QuickTime" : "MP4");
    const m = await readMovie(read, f.size);
    if (!m || !m.width) return { status: "uploaded", info: `${size} · ${ext === "mov" ? "QuickTime" : "MP4"} file`, checks: [{ state: "warn", text: `Could not read the picture details of ${f.name}. Check it plays before you continue.` }] };
    const parts = [size, `${resolution(m.width, m.height)}${m.hdr ? " " + m.hdr : ""}`, m.codec, m.fps ? `${m.fps} fps` : "", m.durationSec ? runtime(m.durationSec) : ""].filter(Boolean);
    const checks: UploadCheck[] = [{ state: "ok", text: `${f.kind === "trailer" ? "Trailer" : "Master"} reads cleanly: ${Math.round(m.width)}×${Math.round(m.height)}, ${m.codec || "unknown codec"}${m.fps ? `, ${m.fps} fps` : ""}` }];
    if (f.kind === "master" && m.width < 1900) checks.push({ state: "warn", text: "Master is below 1080p. Big screens will look soft" });
    if (m.hdr) checks.push({ state: "ok", text: `${m.hdr} colour found. Viewers with HDR screens get it` });
    if (!m.audioTracks) checks.push({ state: "warn", text: `${f.name} has no sound track` });
    return { status: "uploaded", info: parts.join(" · "), checks, durationSec: m.durationSec };
  }
  if (ext === "mxf") {
    if (head.readUInt32BE(0) !== 0x060e2b34) return bad("MXF");
    return { status: "uploaded", info: `${size} · MXF (SMPTE)`, checks: [{ state: "ok", text: `${f.name} is a valid MXF file` }] };
  }
  if (ext === "xml") {
    const t = head.toString("utf8");
    if (!t.trimStart().startsWith("<")) return bad("XML");
    const what = /CompositionPlaylist/.test(t) ? "IMF composition playlist" : /AssetMap/.test(t) ? "IMF asset map" : /PackingList/.test(t) ? "IMF packing list" : "";
    return what ? { status: "uploaded", info: `${size} · ${what}`, checks: [{ state: "ok", text: `${what} found` }] }
      : { status: "uploaded", info: `${size} · XML`, checks: [{ state: "warn", text: `${f.name} is not part of an IMF package` }] };
  }
  if (["wav", "aif", "aiff", "flac"].includes(ext)) {
    const a = readAudio(head, f.size);
    if (!a) return bad(ext.toUpperCase());
    const layout = a.channels === 6 ? "5.1" : a.channels === 8 ? "7.1" : a.channels === 2 ? "stereo" : `${a.channels} channels`;
    return {
      status: "uploaded",
      info: `${size} · ${a.format} ${layout} · ${a.rate / 1000} kHz · ${a.bits}-bit${a.durationSec ? " · " + runtime(a.durationSec) : ""}`,
      checks: [{ state: a.rate >= 48000 ? "ok" : "warn", text: a.rate >= 48000 ? `Audio stems found (${layout}, ${a.rate / 1000} kHz). Dubs can keep your music and effects` : `Stems are ${a.rate / 1000} kHz. We need 48 kHz or more` }],
      durationSec: a.durationSec,
    };
  }
  if (["srt", "vtt", "ttml"].includes(ext)) {
    if (f.size > 10 * 1024 * 1024) return { status: "failed", info: `${size} · too big for a subtitle file`, checks: [{ state: "warn", text: `${f.name} is over 10 MB. Is it really subtitles?` }] };
    const raw = f.size <= head.length ? head : await read(0, f.size - 1);
    if (raw.includes(0)) return bad("subtitle");
    const sub = readSubtitles(raw.toString("utf8"));
    if (!sub.cues) return bad("subtitle");
    const checks: UploadCheck[] = [];
    let language = "";
    try {
      const r = await rateDialogue(sub.text);
      if (r) {
        language = r.language;
        checks.push({ state: "warn", text: `Age rating suggestion: ${r.rating}${r.reasons.length ? ` (${r.reasons.join(", ")})` : ""}. You confirm it in Details` });
      }
    } catch { /* the rating is a suggestion; the upload stands without it */ }
    checks.unshift(sub.outOfOrder || sub.overlaps
      ? { state: "warn", text: `${f.name}: ${sub.outOfOrder ? `${sub.outOfOrder} lines out of order` : ""}${sub.outOfOrder && sub.overlaps ? ", " : ""}${sub.overlaps ? `${sub.overlaps} lines overlap` : ""}` }
      : { state: "ok", text: `${f.name}: every line is in time order` });
    return { status: "uploaded", info: `${language ? language + " subtitles" : "Subtitles"} · ${sub.cues.toLocaleString("en-GB")} lines · ends at ${clock(sub.lastEndSec)}`, checks, durationSec: sub.lastEndSec };
  }
  return bad(ext);
}

export const laterChecks = LATER;
