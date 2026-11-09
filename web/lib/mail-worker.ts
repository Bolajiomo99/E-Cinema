import "server-only";
import { emailEnabled } from "@/lib/email";
import { dirOf, isLang, langForCountry } from "@/lib/i18n";
import { renderMail, type Outgoing } from "@/lib/mail";
import { translateHtml, translateText } from "@/lib/translate";

// Sends the email outbox (Figma page 08 Emails): every minute it collects due emails from the
// API, renders each design and sends it through Resend, then reports the outcome so failures
// are retried and nothing goes out twice. Resend allows about two requests a second.
async function internal<T>(path: string, body: unknown = {}): Promise<T | null> {
  const base = process.env.API_URL, token = process.env.INTERNAL_API_TOKEN;
  if (!base || !token) return null;
  const r = await fetch(`${base}${path}`, {
    method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body), signal: AbortSignal.timeout(30_000), cache: "no-store",
  }).catch(() => null);
  if (!r?.ok) return null;
  return (await r.json().catch(() => ({}))) as T;
}

async function deliver(m: Outgoing): Promise<string> {
  const rendered = renderMail(m);
  if (!rendered) return "no design for this email";
  // In the member's language: the one they picked, else their country's (English in Nigeria).
  const lang = isLang(m.lang) ? m.lang : langForCountry(m.country);
  const mail = lang === "en" || m.kind === "error_alert" || m.kind === "support_new" ? rendered : {
    ...rendered,
    subject: await translateText(lang, rendered.subject),
    html: (await translateHtml(lang, rendered.html)).replace("<html>", `<html lang="${lang}" dir="${dirOf(lang)}">`),
    text: await translateText(lang, rendered.text),
  };
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json", "Idempotency-Key": `outbox-${m.id}` },
    body: JSON.stringify({ from: mail.from, to: [m.name ? `${m.name.replace(/[<>"]/g, "")} <${m.to}>` : m.to], subject: mail.subject, html: mail.html, text: mail.text, headers: mail.headers }),
    signal: AbortSignal.timeout(15_000),
  }).catch((e: unknown) => (e instanceof Error ? e.message : "network error"));
  if (typeof res === "string") return res;
  return res.ok ? "" : `Resend ${res.status}`;
}

let running = false;
export async function runMailOutbox() {
  if (running || !emailEnabled) return 0;
  running = true;
  let sent = 0;
  try {
    const due = await internal<{ mail?: Outgoing[] }>("/v1/mail/due?limit=50");
    for (const m of due?.mail ?? []) {
      const failure = await deliver(m);
      if (!failure) sent++;
      else console.error("mail", m.kind, m.id, failure);
      await internal(`/v1/mail/${m.id}/done`, { error: failure });
      await new Promise((r) => setTimeout(r, 600));
    }
  } catch (e) {
    console.error("mail outbox", e instanceof Error ? e.message : e);
  } finally {
    running = false;
  }
  return sent;
}

export function startMailWorker() {
  setInterval(() => void runMailOutbox(), 60_000).unref?.();
}
