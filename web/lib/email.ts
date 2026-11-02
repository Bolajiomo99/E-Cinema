import "server-only";

// Transactional email through Resend (sending-only key in RESEND_API_KEY).
// Layout follows the Figma "08 Emails" page (106:84 reset code, 106:117 password changed).
export const emailEnabled = Boolean(process.env.RESEND_API_KEY);
const FROM = "E-Cinema <security@e-cinema.net>";
const site = () => process.env.WEB_URL || "https://e-cinema.net";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const FONT = "Manrope,'Segoe UI',Helvetica,Arial,sans-serif";

function layout(preview: string, title: string, body: string, tag = "SECURITY", footer?: string) {
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width"><meta name="color-scheme" content="light"></head>
<body style="margin:0;background:#ececef;font-family:${FONT};color:#16161a">
<div style="display:none;max-height:0;overflow:hidden">${esc(preview)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 0">
<table role="presentation" width="100%" style="max-width:600px;background:#ffffff" cellpadding="0" cellspacing="0">
<tr><td style="background:#0b0b0d;padding:24px 28px"><table role="presentation" width="100%"><tr>
<td><img src="${site()}/email/logo.png" width="116" height="34" alt="E-CINEMA" style="display:block;border:0"></td>
<td align="right" style="font:700 12px/1 ${FONT};letter-spacing:1px;color:#a6a6b0">${esc(tag)}</td></tr></table></td></tr>
<tr><td style="padding:36px 36px 32px">
<h1 style="margin:0 0 20px;font:800 28px/1.2 ${FONT};color:#16161a">${esc(title)}</h1>
${body}
</td></tr>
<tr><td style="background:#f4f4f6;padding:24px 36px;font:500 12px/1.6 ${FONT};color:#7a7a84">
<p style="margin:0 0 8px">${footer ? esc(footer) : "This is a service message about your account. You cannot unsubscribe from security, payment and order emails."}</p>
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

async function send(to: string, subject: string, html: string, text: string, from = FROM) {
  if (!emailEnabled) throw new Error("Email is not switched on here");
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to: [to], subject, html, text }),
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

// Watch party invite (Figma "Web / Create watch party", 31:934).
export async function sendPartyInvite(to: string, host: string, party: string, film: string, when: string, link: string) {
  await send(
    to,
    `${host} invited you to watch ${film} together`,
    layout(`${party} · ${when}`, `Join ${party}`,
      p(`${esc(host)} is watching the world premiere of <b>${esc(film)}</b> on E-Cinema and wants you in the party.`) +
      facts([["Premiere", film], ["When", when], ["Host", host]]) +
      button(link, "Join the watch party") +
      p("Each guest gets their own seat. The film plays at the same second for everyone, with dubs and subtitles in your language."),
      "WATCH PARTY",
      `You got this email because ${host} added your address to a watch party. We only email you again if someone invites you.`),
    `${host} invited you to ${party} for the premiere of ${film} (${when}). Join: ${link}`,
    "E-Cinema <parties@e-cinema.net>",
  );
}

export async function sendAdultCode(to: string, code: string, film: string, stage: number, where: Where) {
  await send(
    to,
    `${code} is your E-Cinema adult payment code`,
    layout("Your code is inside. It ends in 10 minutes", "Adult payment code",
      p(`Use this code with your adult PIN to pay stage ${stage} of 4 for ${esc(film)}, asked from ${esc(where.device)}${where.place ? `, ${esc(where.place)}` : ""}.`) +
      codeBox(code) +
      note("Did not ask for this? Change your password, because someone may be signed in to your account. Nobody can pay without your PIN and this code.")),
    `Your E-Cinema adult payment code is ${code}. It works once and ends in 10 minutes.`,
  );
}

// Sold-out lottery (Figma 31:1121): the draw picked you.
export async function sendLotteryWin(to: string, name: string, film: string, showtimeId: string) {
  const link = `${site()}/sold-out/${showtimeId}`;
  await send(
    to,
    `You won a free seat for ${film}`,
    layout("Claim it within 30 minutes", "You won a free seat",
      p(`${esc(name || "Hi")}, the draw for <b>${esc(film)}</b> picked your entry. The seat is yours for nothing, but it is held for only 30 minutes.`) +
      button(link, "Claim my free seat") +
      note("If you do not claim it in time, the seat goes back to the waitlist."),
      "FREE SEAT"),
    `You won a free seat for ${film}. Claim it within 30 minutes: ${link}`,
  );
}

// Waitlist: a paid seat came back.
export async function sendSeatBack(to: string, name: string, film: string, showtimeId: string) {
  const link = `${site()}/checkout?film=${showtimeId}`;
  await send(
    to,
    `A seat for ${film} just came back`,
    layout("First come, first served", "A seat came back",
      p(`${esc(name || "Hi")}, someone gave back a seat for <b>${esc(film)}</b>. Everyone on the waitlist for it hears at the same time as seats return, so be quick.`) +
      button(link, "Get the seat"),
      "WAITLIST"),
    `A seat for ${film} came back: ${link}`,
  );
}

// Gift a seat (Figma 94:1398): the gift lands on its delivery date.
export async function sendGift(to: string, name: string, giver: string, what: string, message: string, code: string) {
  const link = `${site()}/gift/redeem/${code}`;
  await send(
    to,
    `${giver} sent you ${what} on E-Cinema`,
    layout(message || "Open it to claim your gift", `${name ? `${name}, you` : "You"} have a gift`,
      p(`${esc(giver)} sent you <b>${esc(what)}</b>.`) +
      (message ? note(`“${esc(message)}”<br><span style="color:#7a7a84">${esc(giver)}</span>`) + `<div style="height:20px"></div>` : "") +
      button(link, "Claim my gift") +
      facts([["Gift code", code], ["Works in", "Any country, any currency"]]) +
      p("Sign in or join free to claim it. The gift is yours once you claim it; until then nobody else can use the code without this email."),
      "GIFT",
      `You got this email because ${giver} sent a gift to this address. We will not email you again unless someone sends you another.`),
    `${giver} sent you ${what} on E-Cinema.${message ? ` “${message}”` : ""} Claim it: ${link} (code ${code})`,
    "E-Cinema <gifts@e-cinema.net>",
  );
}

// WhatsApp delivery is not switched on yet, so the giver passes the link on themselves.
export async function sendGiftToForward(to: string, name: string, phone: string, what: string, code: string) {
  const link = `${site()}/gift/redeem/${code}`;
  await send(
    to,
    `Your gift for ${name || phone} is ready to send`,
    layout("Forward the link by WhatsApp or text", "Your gift is ready",
      p(`Your gift of <b>${esc(what)}</b> for ${esc(name || phone)} is ready. Sending it by WhatsApp from E-Cinema is coming soon, so please pass this link on to ${esc(phone || "them")} yourself.`) +
      facts([["Link", link], ["Gift code", code]]) +
      button(link, "Open the gift page") +
      note("Only share this link with the person the gift is for: whoever claims it first gets it."),
      "GIFT"),
    `Your gift for ${name || phone} is ready. Send them this link: ${link} (code ${code})`,
    "E-Cinema <gifts@e-cinema.net>",
  );
}

// Student offer (Figma 94:1327): the code goes to the school email, not the account email.
export async function sendStudentCode(to: string, code: string, school: string) {
  await send(
    to,
    `${code} is your E-Cinema student code`,
    layout("Your code is inside. It ends in 10 minutes", "Confirm you study here",
      p(`Someone asked to verify ${esc(to)} as a student at ${esc(school)} for Student Pro on E-Cinema.`) +
      codeBox(code) +
      note("Did not ask for this? Ignore this email. Nothing happens without the code, and it ends in 10 minutes."),
      "STUDENT"),
    `Your E-Cinema student code is ${code}. It works once and ends in 10 minutes.`,
  );
}

// Careers (Figma 114:1397, 114:1531): application received, and each step after.
const CAREERS_FROM = "E-Cinema Careers <careers@e-cinema.net>";
const CAREERS_FOOTER = "You get this because you applied for a role at E-Cinema. Withdraw any time from My applications.";

export async function sendApplicationReceived(to: string, name: string, role: string) {
  const link = `${site()}/careers/applications`;
  await send(
    to,
    `We got your application: ${role}`,
    layout("You hear back within 10 working days", "Application received",
      p(`${esc(name)}, thank you for applying for <b>${esc(role)}</b>. A person on the hiring team reads every application. AI only helps sort, never rejects.`) +
      p("You hear back within 10 working days, every time.") +
      button(link, "Track my application"),
      "CAREERS", CAREERS_FOOTER),
    `Thank you for applying for ${role}. You hear back within 10 working days. Track it: ${link}`,
    CAREERS_FROM,
  );
}

const STEP_TITLE: Record<string, string> = {
  chat: "Let's have a chat", task: "Your paid take-home task", team: "Meet the team", offer: "We would like to offer you the role", hired: "Welcome to E-Cinema", closed: "An update on your application",
};

export async function sendApplicationUpdate(to: string, name: string, role: string, stage: string, message: string, rows: [string, string][]) {
  const link = `${site()}/careers/applications`;
  const title = STEP_TITLE[stage] ?? "An update on your application";
  await send(
    to,
    `${title}: ${role}`,
    layout(message || title, title,
      p(`${esc(name)}, here is the next step for <b>${esc(role)}</b>.`) +
      (message ? p(esc(message)) : "") +
      (rows.length ? facts(rows) : "") +
      button(link, "Open my applications"),
      "CAREERS", CAREERS_FOOTER),
    `${title} (${role}). ${message} ${rows.map(([k, v]) => `${k}: ${v}`).join(". ")} ${link}`,
    CAREERS_FROM,
  );
}

// For business (Figma 94:1239): a quote request lands with the sales inbox.
export async function sendQuoteRequest(org: string, email: string, guests: number, country: string, kind: string, note: string) {
  await send(
    process.env.SALES_EMAIL || "admin@e-cinema.net",
    `Group screening quote: ${org}, ${guests.toLocaleString("en-GB")} guests`,
    layout(`${org} asked for a quote`, "New quote request",
      facts([["Organisation", org], ["Work email", email], ["Guests", guests.toLocaleString("en-GB")], ["Country", country], ["Kind", kind || "Not said"]]) +
      (note ? p(esc(note)) : "") + button(`${site()}/careers/desk#quotes`, "Open the sales list"),
      "SALES", "Sent to the E-Cinema sales inbox."),
    `Quote request from ${org} (${email}): ${guests} guests in ${country}. ${note}`,
    "E-Cinema <sales@e-cinema.net>",
  );
}

export async function sendExecInvite(to: string, name: string, role: string, by: string, ends: string) {
  const link = `${site()}/executive`;
  await send(
    to,
    `${by} gave you ${role} access to E-Cinema`,
    layout(`${role} access`, "Your executive access is ready",
      p(`${name ? esc(name) + ", " : ""}${esc(by)} gave you <b>${esc(role)}</b> access to E-Cinema's executive dashboards.`) +
      facts([["Role", role], ["Access ends", ends || "When the CEO removes it"], ["Sign in with", to]]) +
      button(link, "Open the dashboards") +
      p("Sign in, or join with this same email address if you are new to E-Cinema. Your access shows up the moment you are signed in."),
      "EXECUTIVE",
      "You got this email because the CEO of E-Cinema added your address under Access and roles. If you did not expect it, you can ignore it."),
    `${by} gave you ${role} access to E-Cinema. Sign in with ${to} at ${link}${ends ? `. Access ends ${ends}.` : "."}`,
  );
}

export async function sendStudioInvite(to: string, studio: string, by: string, note: string) {
  const link = `${site()}/studio`;
  await send(
    to,
    `${by} invited ${studio || "your studio"} to premiere on E-Cinema`,
    layout("Premiere your films to watch-together audiences", "Bring your films to E-Cinema",
      p(`${esc(by)} from E-Cinema would like ${studio ? `<b>${esc(studio)}</b>` : "your studio"} to premiere films on E-Cinema, where audiences around the world watch new releases together, live, with AI dubbing into their own language.`) +
      (note ? note_(note) : "") +
      facts([["Your share of ticket sales", "70%"], ["Payouts", "After each screening ends"], ["Set up", "Self-serve, about 15 minutes"]]) +
      button(link, "Set up your studio") +
      p("You will need your company registration, a document showing you hold the rights, and where to send your money."),
      "STUDIOS",
      "You got this email because someone at E-Cinema invited your studio. We will not email you again unless you set up a studio."),
    `${by} invited ${studio || "your studio"} to premiere films on E-Cinema. Studios keep 70% of ticket sales. Set up: ${link}`,
    "E-Cinema Studios <studios@e-cinema.net>",
  );
}
const note_ = (t: string) => note(`“${esc(t)}”`);
