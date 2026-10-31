"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { LANGS, langName } from "@/lib/i18n";

const CODES =
  "AD AE AF AG AL AM AO AR AT AU AZ BA BB BD BE BF BG BH BI BJ BN BO BR BS BT BW BY BZ CA CD CF CG CH CI CL CM CN CO CR CU CV CY CZ DE DJ DK DM DO DZ EC EE EG ER ES ET FI FJ FM FR GA GB GD GE GH GM GN GQ GR GT GW GY HK HN HR HT HU ID IE IL IN IQ IR IS IT JM JO JP KE KG KH KI KM KN KR KW KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MG MH MK ML MM MN MR MT MU MV MW MX MY MZ NA NE NG NI NL NO NP NR NZ OM PA PE PG PH PK PL PS PT PW PY QA RO RS RU RW SA SB SC SD SE SG SI SK SL SM SN SO SR SS ST SV SY SZ TD TG TH TJ TL TM TN TO TR TT TV TW TZ UA UG US UY UZ VA VC VE VN VU WS YE ZA ZM ZW".split(" ");

// The "NG · English" pill from Figma. Signed-out visitors pick a browsing country (prices and
// payment methods follow it); everyone picks the app language. Any [data-open-locale] link opens it.
export default function LocalePicker({ country, lang, signedIn, homeCountry }: { country?: string; lang: string; signedIn: boolean; homeCountry?: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [c, setC] = useState(country ?? "");
  const [l, setL] = useState(lang);
  const [busy, setBusy] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const names = useMemo(() => {
    let dn: Intl.DisplayNames | undefined;
    try { dn = new Intl.DisplayNames([lang, "en"], { type: "region" }); } catch { /* old browser */ }
    return CODES.map((code) => [code, dn?.of(code) ?? code] as const).sort((a, b) => a[1].localeCompare(b[1]));
  }, [lang]);

  useEffect(() => {
    const opener = (e: MouseEvent) => {
      const a = (e.target as HTMLElement).closest?.("[data-open-locale]");
      if (a) { e.preventDefault(); setOpen(true); wrap.current?.scrollIntoView({ block: "nearest" }); }
    };
    document.addEventListener("click", opener);
    return () => document.removeEventListener("click", opener);
  }, []);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !wrap.current?.contains(e.target as Node) && !(e.target as HTMLElement).closest?.("[data-open-locale]")) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", close); };
  }, [open]);

  async function save() {
    setBusy(true);
    await fetch("/api/locale", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lang: l, ...(signedIn ? {} : { country: c }) }),
    }).catch(() => {});
    setBusy(false);
    setOpen(false);
    router.refresh();
  }

  const shown = signedIn ? homeCountry || country : country;
  return (
    <div className="loc" ref={wrap}>
      <button type="button" className="lp-chip loc-pill" aria-haspopup="dialog" aria-expanded={open} aria-label={`Country and language: ${shown ? `${shown}, ` : ""}${langName(lang)}`} onClick={() => setOpen((o) => !o)}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden><circle cx="12" cy="12" r="10" /><path d="M2 12h20M12 2a15 15 0 0 1 0 20M12 2a15 15 0 0 0 0 20" /></svg>
        <span className="loc-label">{shown ? `${shown} · ` : ""}{langName(lang)}</span>
      </button>
      {open && (
        <div className="loc-pop" role="dialog" aria-label="Country and language">
          <strong>Country and language</strong>
          {signedIn ? (
            <p className="loc-note">Prices follow your home country{shown ? `, ${names.find(([k]) => k === shown)?.[1] ?? shown}` : ""}. Moving? <Link href="/settings/language" onClick={() => setOpen(false)}>Change it in Settings</Link>.</p>
          ) : (
            <label className="loc-field">
              <span>Country</span>
              <select value={c} onChange={(e) => setC(e.target.value)}>
                <option value="">Where I am now</option>
                {names.map(([code, name]) => <option key={code} value={code}>{name}</option>)}
              </select>
            </label>
          )}
          <label className="loc-field">
            <span>Language</span>
            <select value={l} onChange={(e) => setL(e.target.value)}>
              {LANGS.map(([code, name]) => <option key={code} value={code}>{name}</option>)}
            </select>
          </label>
          <p className="loc-note">Menus and headings switch now; the rest of the site follows page by page. Films play with dubs and subtitles in your language where the studio allows it.</p>
          <button type="button" className="lp-btn sm" onClick={save} disabled={busy}>{busy ? "Saving…" : "Save"}</button>
        </div>
      )}
    </div>
  );
}
