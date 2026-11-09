import { cookies, headers } from "next/headers";
import { dict, dirOf, isLang, langForCountry, type Lang } from "@/lib/i18n";

export const COUNTRY_COOKIE = "ec_country";
export const LANG_COOKIE = "ec_lang";

const valid = (c?: string | null) => (c && /^[A-Z]{2}$/.test(c) && c !== "XX" && c !== "T1" ? c : undefined);

// The visitor's browsing country and app language: their pick from the locale picker,
// otherwise the country Cloudflare sees and that country's language (English in Nigeria).
export async function readLocale() {
  const [c, h] = await Promise.all([cookies(), headers()]);
  const picked = valid(c.get(COUNTRY_COOKIE)?.value);
  const country = picked ?? valid(h.get("cf-ipcountry"));
  const raw = c.get(LANG_COOKIE)?.value;
  const lang: Lang = isLang(raw) ? raw : langForCountry(country);
  return { country, picked: Boolean(picked), lang, dir: dirOf(lang), t: dict(lang) };
}
