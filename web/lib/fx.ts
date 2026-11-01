import "server-only";

// Exchange rates for showing shop prices in the viewer's currency. Rates come from a free public
// feed (open.er-api.com) and are cached for six hours; if it cannot be reached, prices stay as the
// shop lists them.
let cache: { at: number; rates: Record<string, number> } | null = null;
const TTL = 6 * 3600_000;

async function rates(): Promise<Record<string, number> | null> {
  if (cache && Date.now() - cache.at < TTL) return cache.rates;
  try {
    const r = await fetch("https://open.er-api.com/v6/latest/USD", { signal: AbortSignal.timeout(5000) });
    if (!r.ok) return cache?.rates ?? null;
    const j = (await r.json()) as { result?: string; rates?: Record<string, number> };
    if (j.result !== "success" || !j.rates) return cache?.rates ?? null;
    cache = { at: Date.now(), rates: j.rates };
    return j.rates;
  } catch {
    return cache?.rates ?? null;
  }
}

// convert turns an amount from one currency into another, or null when no rate is known.
export async function convert(amount: number, from: string, to: string): Promise<number | null> {
  if (from === to) return amount;
  const r = await rates();
  const a = r?.[from], b = r?.[to];
  if (!a || !b) return null;
  return (amount / a) * b;
}
