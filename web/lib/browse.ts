import { endsAt, showtimes, type Showtime } from "@/lib/catalog";

// The ten formats on Browse (Figma 30:564). Each catalogue title belongs to one; formats with
// no premieres yet still show, with an honest empty state, until studios schedule one.
export const TYPES = [
  { id: "movies", label: "Movies", sub: "Hollywood, world cinema and indie premieres", from: "#3a0d12", via: "#120406", glow: "rgba(227,24,45,.55)" },
  { id: "series", label: "Series", sub: "Season premieres and finales, live", from: "#2b2f36", via: "#111317", glow: "rgba(160,170,190,.45)" },
  { id: "anime", label: "Anime", sub: "Japanese audio, AI dubs in 30+ languages", from: "#3d0f2e", via: "#170612", glow: "rgba(230,60,170,.5)" },
  { id: "cartoons", label: "Cartoons", sub: "Kids mode hides chat with strangers and 18+ titles", from: "#3b2a0a", via: "#160f04", glow: "rgba(255,170,40,.5)" },
  { id: "k-drama", label: "K-Drama", sub: "Season finales premiere live, worldwide at once", from: "#1d1440", via: "#0b0819", glow: "rgba(120,90,255,.5)" },
  { id: "nollywood", label: "Nollywood", sub: "Lagos, Kano and Enugu premieres in Yoruba, Hausa, Igbo and English", from: "#0f3324", via: "#06140e", glow: "rgba(255,170,40,.5)" },
  { id: "bollywood", label: "Bollywood", sub: "Hindi premieres with songs subtitled in your language", from: "#4a1d06", via: "#1d0b02", glow: "rgba(255,110,30,.5)" },
  { id: "documentaries", label: "Documentaries", sub: "True stories, premiered with the filmmakers", from: "#083331", via: "#041413", glow: "rgba(40,200,180,.45)" },
  { id: "stand-up", label: "Stand-up", sub: "Comedy specials, laughed at together", from: "#40161f", via: "#1a0a10", glow: "rgba(227,24,45,.5)" },
  { id: "concert-films", label: "Concert films", sub: "Tours and live sets, front row from home", from: "#0c2a3a", via: "#06121a", glow: "rgba(70,150,255,.5)" },
] as const;
export type TypeId = (typeof TYPES)[number]["id"];

export function typeOf(s: Showtime): TypeId {
  switch (s.category) {
    case "Nollywood": return "nollywood";
    case "Bollywood": return "bollywood";
    case "K-Drama": return "k-drama";
    default: return "movies";
  }
}

const CODES: Record<string, string> = { English: "EN", Yoruba: "YO", Hausa: "HA", Igbo: "IG", Hindi: "HI", French: "FR", Korean: "KR", Japanese: "JP", Spanish: "ES", Portuguese: "PT", Arabic: "AR", Swahili: "SW" };
export const langCode = (l?: string) => (l ? CODES[l] ?? l.slice(0, 2).toUpperCase() : "");

export type When = "week" | "next";
const DAY = 86_400_000;

// "This week" is the next seven days (plus anything screening now); "Next week" the seven after.
export function filterShowtimes({ when, lang, now = Date.now() }: { when?: When; lang?: string; now?: number }) {
  return showtimes.filter((s) => {
    if (endsAt(s) <= now) return false;
    const t = Date.parse(s.startsAt);
    if (when === "week" && t > now + 7 * DAY) return false;
    if (when === "next" && (t <= now + 7 * DAY || t > now + 14 * DAY)) return false;
    if (lang && s.language !== lang) return false;
    return true;
  });
}

export const languages = () => [...new Set(showtimes.map((s) => s.language).filter(Boolean) as string[])].sort();
