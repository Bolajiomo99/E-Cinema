import "server-only";
import { createHash } from "node:crypto";

// Checks a password against known leaks with the Have I Been Pwned range API.
// Only the first 5 characters of its SHA-1 hash leave the server (k-anonymity).
// Returns null when the check could not run.
export async function timesLeaked(password: string): Promise<number | null> {
  const hash = createHash("sha1").update(password).digest("hex").toUpperCase();
  try {
    const res = await fetch(`https://api.pwnedpasswords.com/range/${hash.slice(0, 5)}`, {
      headers: { "Add-Padding": "true" },
      signal: AbortSignal.timeout(4000),
      cache: "no-store",
    });
    if (!res.ok) return null;
    const rest = hash.slice(5);
    for (const line of (await res.text()).split("\n")) {
      const [suffix, count] = line.trim().split(":");
      if (suffix === rest) return Number(count) || 0;
    }
    return 0;
  } catch {
    return null;
  }
}
