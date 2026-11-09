import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";

// Brand fonts for share pictures (next/og cannot read woff2, so these are TTF copies of public/fonts).
const dir = path.join(process.cwd(), "assets/og");
let cache: Promise<{ name: string; data: Buffer; weight: 400 | 500 | 700; style: "normal" }[]> | undefined;
export function ogFonts() {
  cache ??= Promise.all([
    readFile(path.join(dir, "bebas-neue.ttf")).then((data) => ({ name: "Bebas Neue", data, weight: 400 as const, style: "normal" as const })),
    readFile(path.join(dir, "manrope-500.ttf")).then((data) => ({ name: "Manrope", data, weight: 500 as const, style: "normal" as const })),
    readFile(path.join(dir, "manrope-700.ttf")).then((data) => ({ name: "Manrope", data, weight: 700 as const, style: "normal" as const })),
  ]);
  return cache;
}
