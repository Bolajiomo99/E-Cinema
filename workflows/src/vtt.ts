// Tiny WebVTT reader: enough to pull cue timings and spoken text.
export interface Cue {
  start: number; // seconds
  end: number;
  text: string;
}

function seconds(t: string): number {
  const parts = t.trim().split(":").map(Number);
  return parts.reduce((acc, p) => acc * 60 + p, 0);
}

export function parseVtt(vtt: string): Cue[] {
  const cues: Cue[] = [];
  for (const block of vtt.replace(/\r/g, "").split(/\n{2,}/)) {
    const lines = block.split("\n");
    const i = lines.findIndex((l) => l.includes("-->"));
    if (i < 0) continue;
    const [a, b] = lines[i].split("-->");
    const text = lines
      .slice(i + 1)
      .join(" ")
      .replace(/<[^>]+>/g, "")
      .replace(/\s+/g, " ")
      .trim();
    if (text) cues.push({ start: seconds(a), end: seconds(b.trim().split(/\s/)[0]), text });
  }
  return cues;
}
