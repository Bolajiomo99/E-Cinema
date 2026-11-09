"use client";

// Sends a browser crash to /api/errors once per message per page load, so the tech team hears
// about problems viewers hit without anyone having to report them.
const sent = new Set<string>();
const IGNORE = [/ResizeObserver loop/, /^Script error\.?$/, /AbortError/, /Load failed$/, /NetworkError when attempting/, /Failed to fetch$/];

export function reportError(err: unknown, extra?: { digest?: string }) {
  try {
    const e = err instanceof Error ? err : new Error(typeof err === "string" ? err : JSON.stringify(err));
    const message = `${e.name && e.name !== "Error" ? `${e.name}: ` : ""}${e.message}${extra?.digest ? ` (digest ${extra.digest})` : ""}`.slice(0, 500);
    if (!message || IGNORE.some((r) => r.test(message)) || sent.has(message) || sent.size > 20) return;
    sent.add(message);
    const body = JSON.stringify({ message, stack: (e.stack ?? "").slice(0, 4000), path: location.pathname });
    fetch("/api/errors", { method: "POST", headers: { "content-type": "application/json" }, body, keepalive: true }).catch(() => undefined);
  } catch {
    // Reporting must never cause a second error.
  }
}
