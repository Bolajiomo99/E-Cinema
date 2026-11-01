// The cookie consent record kept in the ec_consent cookie: which optional groups the viewer allowed.
export type Consent = { performance: boolean; personalisation: boolean; advertising: boolean };
export const NONE: Consent = { performance: false, personalisation: false, advertising: false };
export const ALL: Consent = { performance: true, personalisation: true, advertising: true };

export function readConsent(): Consent | null {
  if (typeof document === "undefined") return null;
  const m = document.cookie.match(/(?:^|; )ec_consent=([^;]*)/);
  if (!m) return null;
  const v = decodeURIComponent(m[1]);
  return { performance: v.includes("p"), personalisation: v.includes("s"), advertising: v.includes("a") };
}

export function saveConsent(c: Consent) {
  const v = (c.performance ? "p" : "") + (c.personalisation ? "s" : "") + (c.advertising ? "a" : "") || "0";
  document.cookie = `ec_consent=${v}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax; secure`;
  window.dispatchEvent(new Event("ec-consent"));
}
