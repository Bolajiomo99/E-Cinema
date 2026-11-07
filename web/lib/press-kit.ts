import "server-only";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";

// The press kit a studio hands to journalists (Studio / Marketing, Figma 39:779): one A4 PDF
// with the key art, synopsis, cast and crew, and when and where the film premieres.
export type PressKit = {
  title: string; logline: string; genres: string; ageRating: string; castCrew: string; languages: string;
  studio: string; city: string; website: string; startsAt: string | null; priceCents: number; link: string;
  poster: { body: Buffer; type: string } | null;
};

const RED = rgb(0.89, 0.094, 0.176), INK = rgb(0.08, 0.08, 0.1), GREY = rgb(0.4, 0.4, 0.45);
const W = 595.28, H = 841.89, M = 56;

// The built-in fonts only cover Western European letters; anything else becomes "?" rather
// than failing the whole document.
function safe(font: PDFFont, s: string) {
  let out = "";
  for (const ch of s.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\r/g, "")) {
    const plain = ch.normalize("NFD").replace(/\p{M}/gu, ""); // ṣ becomes s, ẹ becomes e
    out += [ch, plain].find((c) => { try { font.encodeText(c); return c !== ""; } catch { return false; } }) ?? "?";
  }
  return out;
}

function wrap(font: PDFFont, size: number, text: string, width: number) {
  const lines: string[] = [];
  for (const para of text.split("\n").map((t) => safe(font, t))) {
    let line = "";
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(next, size) <= width || !line) line = next;
      else { lines.push(line); line = word; }
    }
    lines.push(line);
  }
  return lines;
}

export async function pressKitPdf(k: PressKit): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`${k.title} press kit`);
  doc.setAuthor(k.studio);
  doc.setCreator("E-Cinema");
  const reg = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  let page: PDFPage = doc.addPage([W, H]);
  let y = H - M;
  const need = (h: number) => { if (y - h < M + 30) { page = doc.addPage([W, H]); y = H - M; } };
  const text = (s: string, size: number, font: PDFFont, color = INK, x = M, width = W - 2 * M, gap = 1.4) => {
    for (const l of wrap(font, size, s, width)) {
      need(size * gap);
      page.drawText(l, { x, y: y - size, size, font, color });
      y -= size * gap;
    }
  };
  const heading = (s: string) => { y -= 14; need(40); text(s.toUpperCase(), 10, bold, RED); y -= 4; };

  page.drawText("E-CINEMA", { x: M, y: y - 14, size: 14, font: bold, color: RED });
  page.drawText("PRESS KIT", { x: W - M - bold.widthOfTextAtSize("PRESS KIT", 10), y: y - 12, size: 10, font: bold, color: GREY });
  y -= 44;

  // Key art on the left, the essentials beside it.
  let artBottom = y;
  const b = k.poster?.body;
  const png = b && b[0] === 0x89 && b[1] === 0x50, jpg = b && b[0] === 0xff && b[1] === 0xd8; // WebP key art is left out
  if (b && (png || jpg)) {
    try {
      const img = png ? await doc.embedPng(b) : await doc.embedJpg(b);
      const s = img.scaleToFit(200, 300);
      page.drawImage(img, { x: M, y: y - s.height, width: s.width, height: s.height });
      artBottom = y - s.height;
    } catch { /* an unreadable image leaves the page without art */ }
  }
  const left = artBottom < y ? M + 220 : M, colW = W - M - left;
  const top = y;
  text(k.title, 26, bold, INK, left, colW, 1.2);
  y -= 6;
  text(`A film from ${k.studio}${k.city ? `, ${k.city}` : ""}`, 11, reg, GREY, left, colW);
  y -= 10;
  const facts: [string, string][] = [
    ["Genre", k.genres], ["Rated", k.ageRating], ["Languages", k.languages],
    ["Premiere", k.startsAt ? `${new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "UTC" }).format(new Date(k.startsAt))} UTC, worldwide at the same moment` : "Date to be announced"],
    ["Seats", k.priceCents ? `From $${(k.priceCents / 100).toFixed(2)}` : ""],
    ["Book", k.link], ["Studio", k.website],
  ];
  for (const [label, value] of facts) {
    if (!value) continue;
    need(16);
    page.drawText(label, { x: left, y: y - 10, size: 9, font: bold, color: GREY });
    const yy = y;
    text(value, 10, reg, INK, left + 70, colW - 70, 1.45);
    if (y === yy) y -= 14;
    y -= 3;
  }
  y = Math.min(y, artBottom, top - 1) - 12;

  if (k.logline) { heading("Synopsis"); text(k.logline, 11, reg, INK, M, W - 2 * M, 1.5); }
  if (k.castCrew) { heading("Cast and crew"); text(k.castCrew, 11, reg, INK, M, W - 2 * M, 1.5); }
  heading("Watching");
  text("The film premieres once on E-Cinema, at the same moment in every country, with live AI dubbing in many languages and a shared audience chat. Each seat is tied to one verified viewer.", 11, reg, INK, M, W - 2 * M, 1.5);

  for (const p of doc.getPages()) {
    const foot = safe(reg, `${k.title} press kit · Online Cinema Ltd, trading as E-Cinema · e-cinema.net`);
    p.drawText(foot, { x: M, y: M - 20, size: 8, font: reg, color: GREY });
  }
  return doc.save();
}
