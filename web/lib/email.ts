import "server-only";

// Transactional email through Resend (sending-only key in RESEND_API_KEY).
export const emailEnabled = Boolean(process.env.RESEND_API_KEY);
const FROM = "E-Cinema <no-reply@e-cinema.net>";
const site = () => process.env.WEB_URL || "https://e-cinema.net";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function layout(title: string, body: string) {
  return `<!doctype html><html><body style="margin:0;background:#0b0b0d;font-family:Manrope,Arial,sans-serif;color:#f4f4f6">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="100%" style="max-width:480px;background:#131317;border:1px solid #26262e;border-radius:16px" cellpadding="0" cellspacing="0">
<tr><td style="padding:32px">
<div style="font:700 22px/1 'Bebas Neue',Arial,sans-serif;letter-spacing:1px;color:#e50914">E-CINEMA</div>
<h1 style="font-size:22px;margin:24px 0 8px">${esc(title)}</h1>
${body}
<p style="color:#6e6e78;font-size:12px;margin:28px 0 0">Online Cinema Ltd, trading as E-Cinema. We will never ask for your password or code by phone, chat or email.</p>
</td></tr></table></td></tr></table></body></html>`;
}

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

const codeBox = (code: string) =>
  `<div style="font:800 32px/1 monospace;letter-spacing:10px;background:#1c1c22;border-radius:12px;padding:18px;text-align:center;margin:20px 0">${esc(code)}</div>`;

export async function sendLoginCode(to: string, name: string, code: string) {
  await send(
    to,
    `${code} is your E-Cinema sign-in code`,
    layout("Your sign-in code", `<p style="color:#a6a6b0">Hi ${esc(name)}, use this code to sign in. It works once and ends in 10 minutes.</p>${codeBox(code)}
<p style="color:#a6a6b0;font-size:13px">Did not ask for this? You can ignore this email; nobody can sign in without the code.</p>`),
    `Your E-Cinema sign-in code is ${code}. It works once and ends in 10 minutes.`,
  );
}

export async function sendResetCode(to: string, name: string, code: string, identifier: string) {
  const link = `${site()}/forgot?id=${encodeURIComponent(identifier)}&code=${code}`;
  await send(
    to,
    "Reset your E-Cinema password",
    layout("Reset your password", `<p style="color:#a6a6b0">Hi ${esc(name)}, tap the button or enter the code. It works once and ends in 10 minutes.</p>
<p style="margin:24px 0"><a href="${esc(link)}" style="display:inline-block;background:#e50914;color:#fff;text-decoration:none;font-weight:700;padding:14px 22px;border-radius:10px">Reset password</a></p>${codeBox(code)}
<p style="color:#a6a6b0;font-size:13px">Did not ask for this? Ignore this email and your password stays the same.</p>`),
    `Reset your E-Cinema password: ${link}\nOr enter the code ${code}. It works once and ends in 10 minutes.`,
  );
}

export async function sendPasswordChanged(to: string, name: string, lockToken: string, signedOut: number) {
  const link = `${site()}/account/lock?t=${encodeURIComponent(lockToken)}`;
  await send(
    to,
    "Your E-Cinema password was changed",
    layout("Password changed", `<p style="color:#a6a6b0">Hi ${esc(name)}, your password was just changed${signedOut ? " and every other device was signed out" : ""}.</p>
<p style="color:#a6a6b0">Was this not you? Tap below and we lock the account straight away.</p>
<p style="margin:24px 0"><a href="${esc(link)}" style="display:inline-block;background:#26262e;color:#fff;text-decoration:none;font-weight:700;padding:14px 22px;border-radius:10px">This wasn't me</a></p>`),
    `Your E-Cinema password was changed. Not you? Lock your account: ${link}`,
  );
}
