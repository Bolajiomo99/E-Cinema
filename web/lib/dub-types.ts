// AI dubbing (Figma 35:871): shared by the studio page and the dubbing worker.

export type DubStatus = "translating" | "review" | "voicing" | "approved" | "failed";
export type Dub = {
  lang: string; status: DubStatus; voice: "ai" | "clone" | "actor"; lipSync: boolean; keepMusic: boolean; error: string;
  lines: number; flagged: number; voiced: number; approvedAt: string | null; updatedAt: string;
};
export type DubLine = { idx: number; startMs: number; endMs: number; speaker: string; source: string; text: string; flag: string; audioKey: string };

// Languages a film can be dubbed into, by English name. `voice` marks the ones the AI voice
// model officially speaks; others are translated well but should be listened to with care.
export const DUB_LANGS: { code: string; name: string; voice: boolean }[] = [
  { code: "yo", name: "Yorùbá", voice: false }, { code: "ha", name: "Hausa", voice: false }, { code: "ig", name: "Igbo", voice: false },
  { code: "pcm", name: "Nigerian Pidgin", voice: false }, { code: "sw", name: "Swahili", voice: false }, { code: "am", name: "Amharic", voice: false },
  { code: "zu", name: "Zulu", voice: false }, { code: "so", name: "Somali", voice: false }, { code: "af", name: "Afrikaans", voice: false },
  { code: "en", name: "English", voice: true }, { code: "fr", name: "French", voice: true }, { code: "es", name: "Spanish", voice: true },
  { code: "pt", name: "Portuguese", voice: true }, { code: "de", name: "German", voice: true }, { code: "it", name: "Italian", voice: true },
  { code: "nl", name: "Dutch", voice: true }, { code: "pl", name: "Polish", voice: true }, { code: "sv", name: "Swedish", voice: true },
  { code: "ro", name: "Romanian", voice: true }, { code: "cs", name: "Czech", voice: true }, { code: "el", name: "Greek", voice: true },
  { code: "ru", name: "Russian", voice: true }, { code: "uk", name: "Ukrainian", voice: true }, { code: "tr", name: "Turkish", voice: true },
  { code: "ar", name: "Arabic", voice: true }, { code: "he", name: "Hebrew", voice: false }, { code: "fa", name: "Persian", voice: false },
  { code: "hi", name: "Hindi", voice: true }, { code: "bn", name: "Bengali", voice: false }, { code: "ta", name: "Tamil", voice: true },
  { code: "te", name: "Telugu", voice: false }, { code: "ur", name: "Urdu", voice: false }, { code: "mr", name: "Marathi", voice: false },
  { code: "ja", name: "Japanese", voice: true }, { code: "ko", name: "Korean", voice: true }, { code: "zh", name: "Chinese (Mandarin)", voice: true },
  { code: "id", name: "Indonesian", voice: true }, { code: "ms", name: "Malay", voice: true }, { code: "fil", name: "Filipino", voice: true },
  { code: "th", name: "Thai", voice: false }, { code: "vi", name: "Vietnamese", voice: false },
];

export const dubLang = (code: string) => DUB_LANGS.find((l) => l.code === code);
export const dubName = (code: string) => dubLang(code)?.name ?? code.toUpperCase();

export function clock(ms: number) {
  const s = Math.floor(ms / 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(Math.floor(s / 3600))}:${p(Math.floor(s / 60) % 60)}:${p(s % 60)}`;
}
