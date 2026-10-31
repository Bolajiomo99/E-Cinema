import "server-only";

// Transactional email through Resend (sending-only key in RESEND_API_KEY).
// Layout follows the Figma "08 Emails" page (106:84 reset code, 106:117 password changed).
export const emailEnabled = Boolean(process.env.RESEND_API_KEY);
const FROM = "E-Cinema <security@e-cinema.net>";
const site = () => process.env.WEB_URL || "https://e-cinema.net";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const FONT = "Manrope,'Segoe UI',Helvetica,Arial,sans-serif";

function layout(preview: string, title: string, body: string) {
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width"><meta name="color-scheme" content="light"></head>
<body style="margin:0;background:#ececef;font-family:${FONT};color:#16161a">
<div style="display:none;max-height:0;overflow:hidden">${esc(preview)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 0">
<table role="presentation" width="100%" style="max-width:600px;background:#ffffff" cellpadding="0" cellspacing="0">
<tr><td style="background:#0b0b0d;padding:24px 28px"><table role="presentation" width="100%"><tr>
<td><img src="${site()}/email/logo.png" width="116" height="34" alt="E-CINEMA" style="display:block;border:0"></td>
<td align="right" style="font:700 12px/1 ${FONT};letter-spacing:1px;color:#a6a6b0">SECURITY</td></tr></table></td></tr>
<tr><td style="padding:36px 36px 32px">
<h1 style="margin:0 0 20px;font:800 28px/1.2 ${FONT};color:#16161a">${esc(title)}</h1>
${body}
</td></tr>
<tr><td style="background:#f4f4f6;padding:24px 36px;font:500 12px/1.6 ${FONT};color:#7a7a84">
<p style="margin:0 0 8px">This is a service message about your account. You cannot unsubscribe from security, payment and order emails.</p>
<p style="margin:0 0 8px">Online Cinema Ltd, trading as E-Cinema · Lagos, Nigeria · e-cinema.net · Help: help@e-cinema.net</p>
<p style="margin:0">We never ask for your password, code or card number by email, phone or chat.</p>
</td></tr></table></td></tr></table></body></html>`;
}

const p = (t: string) => `<p style="margin:0 0 20px;font:500 16px/1.55 ${FONT};color:#3a3a42">${t}</p>`;
const button = (href: string, label: string) =>
  `<p style="margin:0 0 20px"><a href="${esc(href)}" style="display:inline-block;background:#e5182e;color:#ffffff;text-decoration:none;font:600 16px/1 ${FONT};padding:16px 24px;border-radius:8px">${esc(label)}</a></p>`;
const codeBox = (code: string) =>
  `<div style="margin:0 0 20px;background:#f4f4f6;border-radius:12px;padding:22px;text-align:center;font:400 40px/1 'Bebas Neue',Impact,'Arial Narrow',sans-serif;letter-spacing:2px;color:#16161a">${code.slice(0, 3)} ${code.slice(3)}</div>`;
const note = (t: string) =>
  `<div style="margin:0;background:#f8efe4;border-radius:10px;padding:14px 16px;font:500 14px/1.55 ${FONT};color:#3a3a42">${t}</div>`;
const facts = (rows: [string, string][]) =>
  `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 20px;border:1px solid #e2e2e6;border-radius:10px;border-collapse:separate;overflow:hidden">${rows
    .map(([k, v], i) => `<tr style="background:${i % 2 ? "#ffffff" : "#f4f4f6"}"><td style="padding:12px 16px;font:500 14px ${FONT};color:#7a7a84">${esc(k)}</td><td align="right" style="padding:12px 16px;font:600 14px ${FONT};color:#16161a">${esc(v)}</td></tr>`)
    .join("")}</table>`;

async function send(to: string, subject: string, html: string, text: string) {
  if (!emailEnabled) throw new Error("Email is not switched on here");
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: FROM, to: [to], subject, html, text }),
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`Email failed (${res.status})`);
}

export type Where = { device: string; place: string };

export async function sendLoginCode(to: string, code: string, where: Where) {
  await send(
    to,
    `${code} is your E-Cinema sign-in code`,
    layout("Your code is inside. It ends in 10 minutes", "Your sign-in code",
      p(`We got a request to sign in to ${esc(to)} from ${esc(where.device)}${where.place ? `, ${esc(where.place)}` : ""}.`) +
      codeBox(code) +
      note("Did not ask for this? Ignore this email. Nobody can sign in without this code, and it ends in 10 minutes.")),
    `Your E-Cinema sign-in code is ${code}. It works once and ends in 10 minutes.`,
  );
}

export async function sendResetCode(to: string, code: string, identifier: string, where: Where) {
  const link = `${site()}/forgot?id=${encodeURIComponent(identifier)}&code=${code}`;
  await send(
    to,
    "Reset your E-Cinema password",
    layout("Your code is inside. It ends in 10 minutes", "Reset your password",
      p(`We got a request to reset the password for ${esc(to)} from ${esc(where.device)}${where.place ? `, ${esc(where.place)}` : ""}.`) +
      codeBox(code) +
      button(link, "Enter code on the reset page") +
      note("Did not ask for this? Ignore this email. Your password stays the same, and nobody can reset it without this code.")),
    `Reset your E-Cinema password: ${link}\nOr enter the code ${code}. It works once and ends in 10 minutes.`,
  );
}

export async function sendPasswordChanged(to: string, lockToken: string, signedOut: number, where: Where) {
  const link = `${site()}/account/lock?t=${encodeURIComponent(lockToken)}`;
  const when = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "Africa/Lagos", timeZoneName: "short" }).format(new Date());
  await send(
    to,
    "Your E-Cinema password was changed",
    layout("If this was you, you do not need to do anything", "Your password was changed",
      facts([["When", when], ["Device", where.device], ["Place", where.place || "Unknown"], ["Other devices", signedOut ? "Signed out" : "Still signed in"]]) +
      p("If this was you, you are all set.") +
      button(link, "This wasn’t me, lock my account")),
    `Your E-Cinema password was changed (${when}, ${where.device}). Not you? Lock your account: ${link}`,
  );
}

const secondary = (href: string, label: string) =>
  `<p style="margin:0 0 20px"><a href="${esc(href)}" style="display:inline-block;background:#ffffff;color:#16161a;text-decoration:none;font:600 16px/1 ${FONT};padding:15px 23px;border-radius:8px;border:1px solid #d4d4da">${esc(label)}</a></p>`;
const lagosTime = () =>
  new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "Africa/Lagos", timeZoneName: "short" }).format(new Date());

// Figma email 05 "New sign-in on a device" (106:149).
export async function sendNewSignIn(to: string, lockToken: string, where: Where) {
  const when = lagosTime();
  await send(
    to,
    `New sign-in to E-Cinema on ${where.device}`,
    layout(`${where.place ? `${where.place} · ` : ""}${when}`, "New sign-in",
      facts([["Device", where.device], ["Place", where.place || "Unknown"], ["When", when]]) +
      p("Your account allows one person only. If this was not you, we will sign every device out and you reset your password with a code.") +
      button(`${site()}/account/lock?t=${encodeURIComponent(lockToken)}`, "This wasn’t me") +
      secondary(`${site()}/settings/security`, "Review devices")),
    `New sign-in to E-Cinema: ${where.device}, ${where.place || "unknown place"}, ${when}. Not you? ${site()}/account/lock?t=${encodeURIComponent(lockToken)}`,
  );
}

// Figma email 06 "Account deletion scheduled" (106:181).
export async function sendDeletionScheduled(to: string, deleteAfter: string, ticketsLost: number) {
  const day = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "Africa/Lagos" }).format(new Date(deleteAfter));
  await send(
    to,
    `Your E-Cinema account will be deleted on ${day}`,
    layout("Sign in before then to keep it", "We are sorry to see you go",
      p(`Your account and data will be deleted on ${esc(day)}. Until then you can sign in to cancel.`) +
      facts([["Tickets lost", String(ticketsLost)], ["Your data file", "Download it before that date"]]) +
      button(`${site()}/signin`, "Keep my account") +
      secondary(`${site()}/signin?next=${encodeURIComponent("/settings/privacy")}`, "Download my data")),
    `Your E-Cinema account will be deleted on ${day}. Sign in before then to keep it: ${site()}/signin`,
  );
}
