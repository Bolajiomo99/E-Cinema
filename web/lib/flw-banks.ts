// Bank lists and account-name checks for studio bank payouts, from Flutterwave (v3). The key
// in FLUTTERWAVE_SECRET_KEY decides test or live; payouts themselves are sent by the workflow.
export type Bank = { code: string; name: string };

// Countries Flutterwave can pay a bank account in, with the currency it pays in.
export const BANK_COUNTRIES: Record<string, { name: string; currency: string; resolve: boolean }> = {
  NG: { name: "Nigeria", currency: "NGN", resolve: true },
  GH: { name: "Ghana", currency: "GHS", resolve: false },
  KE: { name: "Kenya", currency: "KES", resolve: false },
  UG: { name: "Uganda", currency: "UGX", resolve: false },
  TZ: { name: "Tanzania", currency: "TZS", resolve: false },
  ZA: { name: "South Africa", currency: "ZAR", resolve: false },
};

const base = () => process.env.FLW_API_BASE ?? "https://api.flutterwave.com/v3";
export const banksReady = () => Boolean(process.env.FLUTTERWAVE_SECRET_KEY);

async function flw<T>(method: string, path: string, body?: unknown): Promise<{ ok: boolean; data?: T; message?: string }> {
  try {
    const r = await fetch(`${base()}${path}`, {
      method,
      headers: { authorization: `Bearer ${process.env.FLUTTERWAVE_SECRET_KEY ?? ""}`, "content-type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15_000),
      cache: "no-store",
    });
    const j = (await r.json().catch(() => ({}))) as { status?: string; message?: string; data?: T };
    return { ok: r.ok && j.status === "success", data: j.data, message: j.message };
  } catch {
    return { ok: false, message: "Flutterwave did not answer" };
  }
}

const cache = new Map<string, { at: number; banks: Bank[] }>();

export async function banksFor(country: string): Promise<Bank[] | null> {
  if (!BANK_COUNTRIES[country] || !banksReady()) return null;
  const hit = cache.get(country);
  if (hit && Date.now() - hit.at < 24 * 3600_000) return hit.banks;
  const r = await flw<{ code: string; name: string }[]>("GET", `/banks/${country}`);
  if (!r.ok || !Array.isArray(r.data)) return hit?.banks ?? null;
  const seen = new Set<string>();
  const banks = r.data
    .filter((b) => typeof b.code === "string" && /^[0-9A-Za-z]{2,10}$/.test(b.code) && typeof b.name === "string")
    .filter((b) => (seen.has(b.code) ? false : (seen.add(b.code), true)))
    .map((b) => ({ code: b.code.toUpperCase(), name: b.name.trim().slice(0, 80) }))
    .sort((a, b) => a.name.localeCompare(b.name));
  cache.set(country, { at: Date.now(), banks });
  return banks;
}

// accountName asks the bank (through Flutterwave) whose name an account number is in.
export async function accountName(bankCode: string, number: string): Promise<string | null> {
  if (!/^[0-9A-Z]{2,10}$/.test(bankCode) || !/^[0-9]{10}$/.test(number)) return null;
  const r = await flw<{ account_name?: string }>("POST", "/accounts/resolve", { account_number: number, account_bank: bankCode });
  return r.ok && r.data?.account_name ? r.data.account_name.trim().slice(0, 120) : null;
}
