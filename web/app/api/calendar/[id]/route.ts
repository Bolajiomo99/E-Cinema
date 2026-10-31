import { endsAt, findShowtime } from "@/lib/catalog";

const stamp = (ms: number) => new Date(ms).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
const esc = (s: string) => s.replace(/[\;,]/g, (c) => `\\${c}`);

// An .ics file for one premiere, so viewers can put it in Google, Apple or Outlook calendars.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = (await params).id.replace(/\.ics$/, "");
  const s = findShowtime(id);
  if (!s) return new Response("Unknown premiere", { status: 404 });
  const start = Date.parse(s.startsAt);
  const room = `https://e-cinema.net/room/${s.id}`;
  const ics = [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Online Cinema Ltd//E-Cinema//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${s.id}@e-cinema.net`,
    `DTSTAMP:${stamp(Date.now())}`,
    `DTSTART:${stamp(start)}`,
    `DTEND:${stamp(endsAt(s))}`,
    `SUMMARY:${esc(`${s.film} · E-Cinema premiere`)}`,
    `DESCRIPTION:${esc(`Screens once, for everyone at the same moment. Doors open 15 minutes before. Your room: ${room}`)}`,
    `URL:${room}`,
    "BEGIN:VALARM", "ACTION:DISPLAY", "DESCRIPTION:Premiere starts in 15 minutes", "TRIGGER:-PT15M", "END:VALARM",
    "END:VEVENT", "END:VCALENDAR",
  ].join("\r\n");
  return new Response(ics, {
    headers: { "Content-Type": "text/calendar; charset=utf-8", "Content-Disposition": `attachment; filename="${s.id}.ics"` },
  });
}
