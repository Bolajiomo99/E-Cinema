import "server-only";
import { FONT, button, esc, facts, layout, p, site } from "@/lib/email";
import { marketOf } from "@/lib/premiere-types";
import { vatRate } from "@/lib/plans";

// The designs on Figma page 08 Emails (106:5), one per outbox kind. The API queues the facts
// (api/internal/notify/mail.go); this file turns them into the email. Each template returns
// null when the facts it needs are missing, and the email is then given up, never half sent.

export type Outgoing = { id: number; kind: string; to: string; name: string; country: string; data: Record<string, unknown> };
export type Rendered = { from: string; subject: string; html: string; text: string; headers?: Record<string, string> };

const S = (v: unknown) => (typeof v === "string" ? v : typeof v === "number" ? String(v) : "");
const N = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const first = (name: string) => name.trim().split(/\s+/)[0] || "there";
const href = (path: string) => (path.startsWith("http") ? path : `${site()}${path}`);

const SENDER = {
  hello: "E-Cinema <hello@e-cinema.net>",
  security: "E-Cinema <security@e-cinema.net>",
  privacy: "E-Cinema <privacy@e-cinema.net>",
  tickets: "E-Cinema <tickets@e-cinema.net>",
  billing: "E-Cinema <billing@e-cinema.net>",
  orders: "E-Cinema Shop <orders@e-cinema.net>",
  gifts: "E-Cinema <gifts@e-cinema.net>",
  family: "E-Cinema <family@e-cinema.net>",
  exec: "E-Cinema <exec@e-cinema.net>",
  studios: "E-Cinema Studios <studios@e-cinema.net>",
  payouts: "E-Cinema Studios <payouts@e-cinema.net>",
  rewards: "E-Cinema <rewards@e-cinema.net>",
  licensing: "E-Cinema <licensing@e-cinema.net>",
} as const;

// Footers: service mail cannot be switched off; the others link to the email settings.
const settingsLink = () => `<a href="${esc(site())}/settings/notifications" style="color:#7a7a84">Email settings</a>`;
const FOOT_ACTION = () => ({ html: `You get this because of an action on your E-Cinema account. ${settingsLink()}` });
const FOOT_NEWS = () => ({ html: `You get this because you said yes to news from E-Cinema. <a href="${esc(site())}/settings/notifications" style="color:#7a7a84">Unsubscribe</a> · ${settingsLink()}` });

// Pieces of the designs that only these emails use.
const refBox = (t: string) =>
  `<div style="margin:0 0 20px;background:#f4f4f6;border-radius:12px;padding:22px;text-align:center;font:400 40px/1 'Bebas Neue',Impact,'Arial Narrow',sans-serif;letter-spacing:2px;color:#16161a">${esc(t)}</div>`;
const ghost = (to: string, label: string) =>
  `<p style="margin:0 0 20px"><a href="${esc(to)}" style="display:inline-block;background:#ffffff;color:#16161a;text-decoration:none;font:600 16px/1 ${FONT};padding:15px 23px;border-radius:8px;border:1px solid #c9c9d0">${esc(label)}</a></p>`;
const small = (t: string) => `<p style="margin:0 0 20px;font:500 14px/1.55 ${FONT};color:#7a7a84">${t}</p>`;
const teal = (t: string) => `<div style="margin:0 0 20px;background:#e6f6f4;border-radius:10px;padding:14px 16px;font:500 14px/1.55 ${FONT};color:#3a3a42">${t}</div>`;
const steps = (list: string[]) =>
  `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 20px">${list
    .map((t, i) => `<tr><td valign="top" style="padding:0 12px 10px 0"><div style="width:22px;height:22px;border-radius:11px;background:#e5182e;color:#fff;font:700 12px/22px ${FONT};text-align:center">${i + 1}</div></td><td style="padding:1px 0 10px;font:500 16px/1.4 ${FONT};color:#3a3a42">${esc(t)}</td></tr>`)
    .join("")}</table>`;
const picks = (rows: { title: string; sub: string; to: string }[]) =>
  `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 20px">${rows
    .map((r) => `<tr><td style="padding:12px 0;border-bottom:1px solid #e2e2e6"><a href="${esc(r.to)}" style="text-decoration:none"><b style="display:block;font:700 16px/1.3 ${FONT};color:#16161a">${esc(r.title)}</b><span style="font:500 14px/1.5 ${FONT};color:#7a7a84">${esc(r.sub)}</span></a></td></tr>`)
    .join("")}</table>`;

// Money and time in the member's own country.
const zoneOf = (country: string) => marketOf(country)?.zone ?? "Africa/Lagos";
function money(minor: number, currency: string) {
  const digits = new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions().maximumFractionDigits ?? 2;
  const v = minor / 10 ** digits;
  return new Intl.NumberFormat(currency === "NGN" ? "en-NG" : "en-GB", { style: "currency", currency, maximumFractionDigits: Number.isInteger(v) ? 0 : 2, minimumFractionDigits: Number.isInteger(v) ? 0 : 2 }).format(v);
}
const withVat = (minor: number, country: string) => Math.round(minor * (1 + vatRate(country)));
function when(iso: string, country: string, opts: { year?: boolean; zone?: boolean } = {}) {
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "short", day: "numeric", month: "short", ...(opts.year ? { year: "numeric" } : {}),
    hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: zoneOf(country), ...(opts.zone ? { timeZoneName: "short" } : {}),
  }).format(new Date(iso));
}
const clock = (iso: string, country: string) => new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: zoneOf(country) }).format(new Date(iso));
const dayName = (iso: string, country: string) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", timeZone: zoneOf(country) }).format(new Date(iso));
const QUALITY: Record<string, string> = { hd: "HD", "4k": "4K HDR", vr: "VR" };
const PLAN: Record<string, string> = { student: "Student", pro: "Pro", vip: "VIP", enterprise: "Business" };

function calendarLink(film: string, showtimeId: string, startsAt: string) {
  const start = new Date(startsAt).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const end = new Date(Date.parse(startsAt) + 2 * 3600_000).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const q = new URLSearchParams({ action: "TEMPLATE", text: `${film} · E-Cinema premiere`, dates: `${start}/${end}`, details: href(`/room/${showtimeId}`) });
  return `https://calendar.google.com/calendar/render?${q}`;
}

type Doc = { from: string; subject: string; preview: string; tag: string; title: string; body: string; text: string; footer?: string | { html: string }; banner?: string; news?: boolean };
const done = (d: Doc): Rendered => ({
  from: d.from,
  subject: d.subject,
  html: layout(d.preview, d.title, d.body, d.tag, d.footer, d.banner),
  text: d.text,
  ...(d.news ? { headers: { "List-Unsubscribe": `<${site()}/settings/notifications>` } } : {}),
});

const T: Record<string, (m: Outgoing) => Rendered | null> = {
  // 01 Welcome (106:39)
  welcome: (m) => done({
    from: SENDER.hello, tag: "WELCOME", banner: "WELCOME TO THE FRONT ROW",
    subject: `Welcome to E-Cinema, ${first(m.name)}. Your seat is ready`, preview: "Three things to do before your first premiere",
    title: `Hi ${first(m.name)}, you are in.`,
    body: p("E-Cinema brings new films to you on opening night, in your language and your currency, so you can watch together with friends anywhere on Earth.") +
      steps(["Pick your languages so dubs and chat translate for you", "Follow studios to hear about premieres first", "Book your first premiere, or join a friend’s room"]) +
      button(href("/browse"), "Find a premiere") +
      teal("Your account is protected by a face check. Only you can use it, on one device at a time.") +
      p("See you at the movies,<br>The E-Cinema team"),
    text: `Hi ${first(m.name)}, you are in.\n\nPick your languages, follow studios and book your first premiere: ${href("/browse")}\n\nSee you at the movies,\nThe E-Cinema team`,
  }),

  // 08 Ticket confirmed (106:242)
  ticket: (m) => {
    const film = S(m.data.film), at = S(m.data.startsAt), id = S(m.data.showtimeId);
    if (!film || !at || !id) return null;
    const paid = money(withVat(N(m.data.netMinor), m.country), S(m.data.currency) || "USD");
    const seats = N(m.data.seats);
    return done({
      from: SENDER.tickets, tag: "TICKET", banner: film.toUpperCase(),
      subject: `You are going to ${film} · ${when(at, m.country)}`, preview: "Seat booked. Add it to your calendar",
      title: seats > 1 ? `Your ${seats} seats are booked` : "Your seat is booked",
      body: facts([
        ["Film", `${film} · ${QUALITY[S(m.data.quality)] ?? "HD"}`],
        ["Premiere", when(at, m.country, { year: true, zone: true })],
        ...(seats > 1 ? [["Seats", String(seats)] as [string, string]] : []),
        ["Paid", `${paid} incl. VAT`],
        ["Ticket", S(m.data.ticket)],
      ]) +
        button(calendarLink(film, id, at), "Add to calendar") +
        ghost(href(`/parties/new?film=${encodeURIComponent(id)}`), "Invite friends to my room") +
        small("This ticket works once, live, on one device, on your verified account only."),
      text: `Your seat for ${film} is booked: ${when(at, m.country, { year: true, zone: true })}. Ticket ${S(m.data.ticket)}. Paid ${paid}.\nRoom: ${href(`/room/${id}`)}`,
    });
  },

  // 10 Pre-order confirmed (106:297)
  preorder: (m) => {
    const film = S(m.data.film), at = S(m.data.startsAt), id = S(m.data.showtimeId);
    if (!film || !at) return null;
    const paid = money(withVat(N(m.data.netMinor), m.country), S(m.data.currency) || "USD");
    return done({
      from: SENDER.tickets, tag: "PRE-ORDER",
      subject: `Pre-order confirmed: ${film}`, preview: `You locked in the stage ${N(m.data.stage) || 1} price`,
      title: "You are on the list",
      body: facts([
        ["Film", film],
        ["Premiere", when(at, m.country, { year: true, zone: true })],
        ["Price locked", `${paid} (stage ${N(m.data.stage) || 1})`],
        ["Change of mind", "Full credit until 48 hours before the premiere"],
      ]) +
        p("We will email you again a week before, so you can pick your language and invite friends.") +
        button(href(`/preorder/${encodeURIComponent(id)}`), "View pre-order"),
      text: `Pre-order confirmed: ${film}, ${when(at, m.country, { year: true, zone: true })}. Price locked at ${paid}.`,
    });
  },

  // 26 Late-entry ticket (118:2961)
  late_ticket: (m) => {
    const film = S(m.data.film), id = S(m.data.showtimeId);
    if (!film || !id) return null;
    const cur = S(m.data.currency) || "USD";
    const total = withVat(N(m.data.netMinor), m.country);
    return done({
      from: SENDER.tickets, tag: "LATE ENTRY", footer: FOOT_ACTION(),
      subject: `You are in: ${film}, joined live at ${N(m.data.minutesIn)} minutes`, preview: `Late-entry seat · ${money(total, cur)} paid`,
      title: "Your late-entry seat is confirmed",
      body: p(`You joined after the first 15 minutes, so the seat cost double (${esc(money(Math.round(total / 2), cur))} × 2). Your 60-second catch-up is ready when you press play. This seat works on one device only. Ticket:`) +
        refBox(S(m.data.ticket)) + button(href(`/room/${encodeURIComponent(id)}`), "Join live now"),
      text: `Your late-entry seat for ${film} is confirmed. Ticket ${S(m.data.ticket)}. Join: ${href(`/room/${id}`)}`,
    });
  },

  // 09 Premiere starts in 1 hour (106:264)
  reminder: (m) => {
    const film = S(m.data.film), at = S(m.data.startsAt), id = S(m.data.showtimeId);
    if (!film || !at || !id) return null;
    const lobby = N(m.data.lobby);
    return done({
      from: SENDER.tickets, tag: "REMINDER",
      subject: `${film} starts in 1 hour. Your room is open`, preview: lobby > 1 ? `${lobby.toLocaleString("en-GB")} ticket holders are coming tonight` : "Join the lobby and test your sound",
      title: "Doors are open",
      body: p(`${esc(film)} starts at ${clock(at, m.country)}. Join the lobby to chat, order snacks and test your sound.`) +
        button(href(`/room/${encodeURIComponent(id)}`), "Join the lobby") + small("Order snacks now and they arrive before the film starts."),
      text: `${film} starts at ${clock(at, m.country)}. Join the lobby: ${href(`/room/${id}`)}`,
    });
  },

  // 27 Premiere started, not joined yet (127:83)
  not_joined: (m) => {
    const film = S(m.data.film), at = S(m.data.startsAt), id = S(m.data.showtimeId);
    if (!film || !at || !id) return null;
    const mins = Math.max(1, Math.round((Date.now() - Date.parse(at)) / 60_000));
    return done({
      from: SENDER.tickets, tag: "STARTED", footer: FOOT_ACTION(),
      subject: `${film} has started. Your seat is waiting`, preview: "Join now from the live moment",
      title: "Your seat is still yours",
      body: p(`${esc(film)} started ${mins} minutes ago. Your ticket works any time until the end, at no extra cost. Friends without a ticket can join at normal price until ${clock(new Date(Date.parse(at) + 15 * 60_000).toISOString(), m.country)}, then late seats cost double. Ticket:`) +
        refBox(S(m.data.ticket)) + button(href(`/room/${encodeURIComponent(id)}`), "Join live now"),
      text: `${film} has started. Your seat is waiting: ${href(`/room/${id}`)}`,
    });
  },

  // 32 Pre-order, one week to go (127:193)
  preorder_week: (m) => {
    const film = S(m.data.film), at = S(m.data.startsAt), id = S(m.data.showtimeId);
    if (!film || !at || !id) return null;
    return done({
      from: SENDER.tickets, tag: "ONE WEEK", footer: FOOT_ACTION(),
      subject: `One week to ${film}`, preview: "Pick your language and invite friends",
      title: "Your pre-ordered premiere is close",
      body: p(`${esc(film)} premieres in 7 days, ${esc(when(at, m.country))} your time. Choose your audio language now and send room invites so your friends sit with you. Ticket:`) +
        refBox(S(m.data.ticket)) + button(href(`/parties/new?film=${encodeURIComponent(id)}`), "Set up my room"),
      text: `${film} premieres in 7 days, ${when(at, m.country)}. Set up your room: ${href(`/parties/new?film=${id}`)}`,
    });
  },

  // 13 Refund processed (106:384)
  refund: (m) => {
    const cur = S(m.data.currency) || "USD";
    const amount = money(withVat(N(m.data.netMinor), m.country), cur);
    return done({
      from: SENDER.billing, tag: "REFUND",
      subject: `Refund on its way: ${amount}`, preview: "Back to how you paid in 1 to 5 working days",
      title: "Your refund is on its way",
      body: facts([["For", S(m.data.what)], ["Amount", amount], ["Reference", S(m.data.ref)], ["Arrives", "1 to 5 working days"]]) +
        button(href(S(m.data.link) || "/tickets"), "See my tickets"),
      text: `Your refund of ${amount} for ${S(m.data.what)} is on its way. It arrives in 1 to 5 working days.`,
    });
  },

  // 48 Plan renews in 3 days (127:545)
  plan_renews: (m) => {
    const plan = PLAN[S(m.data.plan)], at = S(m.data.renewsAt);
    if (!plan || !at) return null;
    return done({
      from: SENDER.billing, tag: "RENEWAL", footer: FOOT_ACTION(),
      subject: `Your ${plan} plan renews on ${dayName(at, m.country)}`, preview: "Nothing to do if you want to keep it",
      title: "Your plan renews soon",
      body: p(`Your ${plan} plan renews in 3 days through PayPal. Nothing to do if you want to keep it. To change or cancel, open Plan and payments before ${esc(dayName(at, m.country))}. Plan:`) +
        refBox(plan.toUpperCase()) + button(href("/settings/plan"), "Manage my plan"),
      text: `Your ${plan} plan renews on ${dayName(at, m.country)}. Manage it: ${href("/settings/plan")}`,
    });
  },

  // 46 Gift not claimed yet (127:501)
  gift_waiting: (m) => {
    const who = S(m.data.recipient);
    if (!who) return null;
    const what = S(m.data.kind) === "seat" && S(m.data.film) ? `a seat for ${S(m.data.film)}` : S(m.data.kind) === "credit" ? "E-Cinema credit" : "an E-Cinema plan";
    return done({
      from: SENDER.gifts, tag: "GIFT WAITING", footer: FOOT_ACTION(),
      subject: `${first(who)} has not opened your gift yet`, preview: "Send a reminder from your gifts page",
      title: "Your gift is still waiting",
      body: p(`You gave ${esc(first(who))} ${esc(what)} ${N(m.data.days) || 3} days ago, and it has not been claimed yet. You can send a reminder from your gifts page. Gift:`) +
        refBox(S(m.data.gift)) + button(href("/gift"), "Send a reminder"),
      text: `${first(who)} has not opened your gift yet. Send a reminder: ${href("/gift")}`,
    });
  },

  // 21 New on E-Cinema this week (106:635)
  weekly: (m) => {
    const list = (Array.isArray(m.data.picks) ? m.data.picks : []) as Record<string, unknown>[];
    if (!list.length) return null;
    const rows = list.map((x) => ({ title: S(x.film), sub: `${when(S(x.startsAt), m.country)} · ${S(x.studio)}`, to: href(`/film/${encodeURIComponent(S(x.showtimeId))}`) }));
    const names = rows.map((r) => r.title);
    return done({
      from: SENDER.hello, tag: "THIS WEEK", banner: "THIS WEEK ON E-CINEMA", footer: FOOT_NEWS(), news: true,
      subject: `${rows.length} ${rows.length === 1 ? "premiere" : "premieres"} this week`, preview: names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names.at(-1)}` : names[0],
      title: `This week, ${first(m.name)}`,
      body: picks(rows) + button(href("/browse"), "See all premieres"),
      text: `This week on E-Cinema:\n${rows.map((r) => `- ${r.title}, ${r.sub}`).join("\n")}\n\n${href("/browse")}\n\nEmail settings: ${href("/settings/notifications")}`,
    });
  },
};

export const mailKinds = () => Object.keys(T);
export function renderMail(m: Outgoing): Rendered | null {
  const t = T[m.kind];
  if (!t) return null;
  try {
    return t({ ...m, data: m.data ?? {} });
  } catch {
    return null;
  }
}
