import "server-only";
import { FONT, button, esc, facts, layout, p, site } from "@/lib/email";
import { marketOf } from "@/lib/premiere-types";
import { countryName as countryLabel, vatRate } from "@/lib/plans";

// The designs on Figma page 08 Emails (106:5), one per outbox kind. The API queues the facts
// (api/internal/notify/mail.go); this file turns them into the email. Each template returns
// null when the facts it needs are missing, and the email is then given up, never half sent.

export type Outgoing = { id: number; kind: string; to: string; name: string; country: string; lang?: string; data: Record<string, unknown> };
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
  support: "E-Cinema Support <support@e-cinema.net>",
} as const;

// Footers: service mail cannot be switched off; the others link to the email settings.
const settingsLink = () => `<a href="${esc(site())}/settings/notifications" style="color:#8e8e99">Email settings</a>`;
const FOOT_ACTION = () => ({ html: `You get this because of an action on your E-Cinema account. ${settingsLink()}` });
const FOOT_STUDIO = () => ({ html: `You get this as a member of a studio on E-Cinema. <a href="${esc(site())}/studio/settings#notifications" style="color:#8e8e99">Choose which studio emails you get</a>` });
const FOOT_NEWS = () => ({ html: `You get this because you said yes to news from E-Cinema. <a href="${esc(site())}/settings/notifications" style="color:#8e8e99">Unsubscribe</a> · ${settingsLink()}` });

// Pieces of the designs that only these emails use.
const refBox = (t: string) =>
  `<div style="margin:0 0 20px;background:#f4f4f6;border-radius:12px;padding:22px;text-align:center;font:400 40px/1 'Bebas Neue',Impact,'Arial Narrow',sans-serif;letter-spacing:2px;color:#16161a">${esc(t)}</div>`;
const ghost = (to: string, label: string) =>
  `<p style="margin:0 0 20px"><a href="${esc(to)}" style="display:inline-block;background:#ffffff;color:#16161a;text-decoration:none;font:600 16px/1 ${FONT};padding:15px 23px;border-radius:8px;border:1px solid #c9c9d0">${esc(label)}</a></p>`;
const bigCode = (code: string) =>
  `<div style="margin:0 0 20px;background:#f5f5f7;border-radius:10px;padding:18px;text-align:center;font:400 40px/1.1 'Bebas Neue',Impact,'Arial Narrow',sans-serif;letter-spacing:0.5px;color:#141418">${/^\d{6}$/.test(code) ? `${code.slice(0, 3)} ${code.slice(3)}` : esc(code)}</div>`;
const small = (t: string) => `<p style="margin:0 0 20px;font:500 14px/1.55 ${FONT};color:#8e8e99">${t}</p>`;
const teal = (t: string) => `<div style="margin:0 0 20px;background:#e6f6f4;border-radius:10px;padding:14px 16px;font:500 14px/1.55 ${FONT};color:#3a3a42">${t}</div>`;
const steps = (list: string[]) =>
  `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 20px">${list
    .map((t, i) => `<tr><td valign="top" style="padding:0 12px 10px 0"><div style="width:22px;height:22px;border-radius:11px;background:#e5182e;color:#fff;font:700 12px/22px ${FONT};text-align:center">${i + 1}</div></td><td style="padding:1px 0 10px;font:500 16px/1.4 ${FONT};color:#3a3a42">${esc(t)}</td></tr>`)
    .join("")}</table>`;
const picks = (rows: { title: string; sub: string; to: string }[]) =>
  `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 20px">${rows
    .map((r) => `<tr><td style="padding:12px 0;border-bottom:1px solid #e2e2e6"><a href="${esc(r.to)}" style="text-decoration:none"><b style="display:block;font:700 16px/1.3 ${FONT};color:#16161a">${esc(r.title)}</b><span style="font:500 14px/1.5 ${FONT};color:#8e8e99">${esc(r.sub)}</span></a></td></tr>`)
    .join("")}</table>`;

// Money and time in the member's own country.
const zoneOf = (country: string) => marketOf(country)?.zone ?? "Africa/Lagos";
function money(minor: number, currency: string) {
  const digits = new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions().maximumFractionDigits ?? 2;
  const v = minor / 10 ** digits;
  return new Intl.NumberFormat(currency === "NGN" ? "en-NG" : currency === "USD" ? "en-US" : "en-GB", { style: "currency", currency, maximumFractionDigits: Number.isInteger(v) ? 0 : 2, minimumFractionDigits: Number.isInteger(v) ? 0 : 2 }).format(v);
}
// A PayPal amount ("4500.00") in the same style.
function major(amount: string, currency: string) {
  const v = Number(amount);
  if (!amount || !currency || !Number.isFinite(v)) return "";
  const digits = new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions().maximumFractionDigits ?? 2;
  return money(Math.round(v * 10 ** digits), currency);
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
    const amount = money(m.data.gross ? N(m.data.netMinor) : withVat(N(m.data.netMinor), m.country), cur);
    return done({
      from: SENDER.billing, tag: "REFUND",
      subject: `Refund on its way: ${amount}`, preview: "Back to how you paid in 1 to 5 working days",
      title: "Your refund is on its way",
      body: facts([["For", S(m.data.what)], ["Amount", amount], ["Reference", S(m.data.ref)], ["Arrives", "1 to 5 working days"]]) +
        button(href(S(m.data.link) || "/tickets"), "See my tickets"),
      text: `Your refund of ${amount} for ${S(m.data.what)} is on its way. It arrives in 1 to 5 working days.`,
    });
  },

  // 29 Premiere moved to a new date (127:127)
  premiere_moved: (m) => {
    const film = S(m.data.film), studio = S(m.data.studio), at = S(m.data.startsAt), until = S(m.data.refundUntil);
    if (!film || !at || !until) return null;
    const short = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: zoneOf(m.country) }).format(new Date(at));
    const long = new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: zoneOf(m.country) }).format(new Date(at));
    return done({
      from: SENDER.tickets, tag: "NEW DATE", footer: FOOT_ACTION(),
      subject: `${film} moved to ${short}, ${clock(at, m.country)}`, preview: "Your seat moves with it, or take a refund",
      title: "Your premiere has a new date",
      body: p(`${esc(studio || "The studio")} moved ${esc(film)} to ${esc(long)} at ${clock(at, m.country)} your time. Your seat moves automatically. If the new date does not work, take a full refund by ${esc(dayName(until, m.country))}. Ticket:`) +
        refBox(S(m.data.ticket)) + button(href("/tickets"), "Keep my seat") +
        small(`Need the refund instead? Open the ticket in <a href="${esc(href("/tickets"))}" style="color:#e5182e">My tickets</a> and choose Refund.`),
      text: `${studio || "The studio"} moved ${film} to ${long} at ${clock(at, m.country)} your time. Your seat moves automatically. For a full refund by ${dayName(until, m.country)}, open ${href("/tickets")}.`,
    });
  },

  // 30 Premiere cancelled, refund sent (127:149)
  premiere_cancelled: (m) => {
    const film = S(m.data.film), cur = S(m.data.currency) || "USD";
    if (!film) return null;
    const amount = money(m.data.gross ? N(m.data.netMinor) : withVat(N(m.data.netMinor), m.country), cur);
    const credit = m.data.credit === true;
    const where = credit ? "your E-Cinema credit" : "the card or account you paid with";
    return done({
      from: SENDER.billing, tag: "REFUNDED", footer: FOOT_ACTION(),
      subject: `${film} is cancelled. ${amount} is on its way back`, preview: credit ? "Back in your E-Cinema credit now" : "Back to how you paid in 1 to 5 working days",
      title: "We are sorry, this premiere is cancelled",
      body: p(`The studio cancelled ${esc(film)}. We refunded ${esc(amount)} to ${where}${credit ? "" : ". It arrives in 1 to 5 working days"}. Refund reference:`) +
        refBox(S(m.data.ref)) + button(href("/tickets"), credit ? "See my credit" : "See my tickets"),
      text: `The studio cancelled ${film}. We refunded ${amount} to ${where}. Reference ${S(m.data.ref)}.`,
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
  // 17 Kids purchase needs approval (106:499)
  kids_request: (m) => {
    const kid = S(m.data.profile), what = S(m.data.what);
    if (!kid || !what) return null;
    return done({
      from: SENDER.family, tag: "FAMILY",
      subject: `${kid} wants ${what}`, preview: "Approve or decline in one tap",
      title: `Approve ${kid}’s request?`,
      body: facts([["Profile", N(m.data.age) ? `${kid}, ${N(m.data.age)}` : kid], ["Wants", what]]) +
        button(href(`/family?request=${encodeURIComponent(S(m.data.request))}`), "Approve or decline") +
        small("Only a grown-up on this account can decide. Nothing is bought until you approve."),
      text: `${kid} wants ${what}. Approve or decline: ${href("/family")}`,
    });
  },

  // 14 Order shipped (106:416)
  order_shipped: (m) => {
    const items = (Array.isArray(m.data.items) ? m.data.items : []).map(S).filter(Boolean);
    if (!S(m.data.order)) return null;
    const eta = S(m.data.eta);
    return done({
      from: SENDER.orders, tag: "ORDER",
      subject: items.length === 1 ? `Your ${items[0]} is on the way` : `Order ${S(m.data.order)} is on the way`, preview: eta ? `Arriving ${when(eta, m.country)}, track it live` : "Track it live",
      title: "On the way",
      body: facts([
        ["Order", S(m.data.order)],
        ["Items", items.join(" · ")],
        ...(S(m.data.rider) ? [["Rider", `${S(m.data.rider)}${S(m.data.vehicle) ? ` · ${S(m.data.vehicle)}` : ""}`] as [string, string]] : []),
        ...(eta ? [["Arriving", when(eta, m.country)] as [string, string]] : []),
      ]) + button(href(`/shop/orders?o=${encodeURIComponent(S(m.data.orderId))}`), "Track my order"),
      text: `Order ${S(m.data.order)} is on the way. Track it: ${href(`/shop/orders?o=${S(m.data.orderId)}`)}`,
    });
  },

  // 15 Order delivered (106:438)
  order_delivered: (m) => {
    const items = (Array.isArray(m.data.items) ? m.data.items : []).map(S).filter(Boolean);
    if (!S(m.data.order)) return null;
    const at = S(m.data.at);
    return done({
      from: SENDER.orders, tag: "ORDER",
      subject: items.length === 1 ? `Delivered: your ${items[0]}` : `Delivered: order ${S(m.data.order)}`, preview: "You can return anything within 14 days",
      title: "Delivered",
      body: p(`Your order ${esc(S(m.data.order))} arrived${at ? ` at ${clock(at, m.country)}` : ""}. Enjoy it, and tell other fans what you think with a review.`) +
        button(href(`/shop/orders?o=${encodeURIComponent(S(m.data.orderId))}`), "See my order") +
        small(`Something wrong? <a href="${esc(href(`/shop/orders?o=${encodeURIComponent(S(m.data.orderId))}`))}" style="color:#8e8e99">Return it</a> within 14 days.`),
      text: `Order ${S(m.data.order)} was delivered. Returns within 14 days: ${href("/shop/orders")}`,
    });
  },

  // 19 Studio approved (106:564)
  studio_approved: (m) => {
    const studio = S(m.data.studio);
    if (!studio) return null;
    return done({
      from: SENDER.studios, tag: "STUDIO",
      subject: `${studio} is approved on E-Cinema`, preview: "Upload your first film",
      title: `Welcome, ${studio}`,
      body: p("Your rights papers are verified. You keep 70% of every ticket, paid after each screening ends.") +
        steps(["Upload your film master", "Approve AI dubs line by line", "Set prices and open pre-sales"]) +
        button(href("/studio"), "Open Studio portal"),
      text: `${studio} is approved on E-Cinema. Open the Studio portal: ${href("/studio")}`,
    });
  },

  // 20 Studio payout sent (106:599)
  studio_payout: (m) => {
    const cur = S(m.data.currency) || "USD", film = S(m.data.film);
    if (!film) return null;
    const share = money(N(m.data.shareMinor), cur);
    return done({
      from: SENDER.payouts, tag: "PAYOUT",
      subject: `Payout sent: ${share}`, preview: `${film}, ${N(m.data.sharePct) || 70}% share`,
      title: "Your payout is on its way",
      body: facts([
        ["Screening", `${film} · ${when(S(m.data.startsAt), m.country)}`],
        ["Seats sold", N(m.data.seats).toLocaleString("en-GB")],
        ["Gross tickets", money(N(m.data.grossMinor), cur)],
        [`Your ${N(m.data.sharePct) || 70}%`, share],
        ["To", `PayPal · ${S(m.data.payTo)}`],
      ]) + button(href("/studio/payouts"), "View statement"),
      text: `Payout sent: ${share} for ${film}. Statement: ${href("/studio/payouts")}`,
    });
  },

  // Studio notification emails (Figma 39:1184 Settings · Notifications). Each member turns them
  // on or off in Studio settings, so the footer says where.
  studio_milestone: (m) => {
    const film = S(m.data.film), pct = N(m.data.pct), sold = N(m.data.sold), cap = N(m.data.capacity), upload = S(m.data.upload);
    if (!film || ![25, 50, 100].includes(pct)) return null;
    const out = pct === 100;
    const link = /^[0-9a-f-]{36}$/.test(upload) ? href(`/studio/films/${upload}?tab=pre-sales`) : href("/studio/premieres");
    return done({
      from: SENDER.studios, tag: out ? "SOLD OUT" : `${pct}% SOLD`, footer: FOOT_STUDIO(),
      subject: out ? `${film} is sold out` : `${film} is ${pct}% sold`, preview: `${sold.toLocaleString("en-GB")} of ${cap.toLocaleString("en-GB")} seats, premiere ${when(S(m.data.startsAt), m.country)}`,
      title: out ? "Every seat is sold" : `${pct}% of seats sold`,
      body: facts([
        ["Film", film],
        ["Premiere", when(S(m.data.startsAt), m.country, { zone: true })],
        ["Seats sold", `${sold.toLocaleString("en-GB")} of ${cap.toLocaleString("en-GB")}`],
      ]) + (out ? p("Fans who missed out can still book an encore once you add one in Premieres and pricing.") : "") + button(link, "See pre-sales"),
      text: `${film}: ${sold} of ${cap} seats sold (${pct}%). Pre-sales: ${link}`,
    });
  },
  // Support inbox (gap list item 10; no Figma frame, built on the service email layout).
  support_received: (m) => {
    const token = S(m.data.token), subject = S(m.data.subject), n = N(m.data.number);
    if (!token || !subject) return null;
    return done({
      from: SENDER.support, tag: "HELP",
      subject: `We got your message: ${subject.slice(0, 80)}`, preview: "A person from our team will answer you here",
      title: "We got your message",
      body: p(`Thank you for writing to us. A person from the E-Cinema team will read it and answer you by email. Your request number is <b>${n}</b>.`) +
        facts([["About", subject], ["Request", `#${n}`]]) +
        button(href(`/help/r/${token}`), "See my request") +
        small("To add anything, open your request with the button above. Replies to this email are not read."),
      text: `We got your message about "${subject}" (request #${n}). A person from the E-Cinema team will answer you by email. See or add to your request: ${href(`/help/r/${token}`)}`,
    });
  },
  support_reply: (m) => {
    const token = S(m.data.token), subject = S(m.data.subject), body = S(m.data.body), n = N(m.data.number);
    if (!token || !body) return null;
    const closed = m.data.closed === true;
    return done({
      from: SENDER.support, tag: "HELP",
      subject: `Re: ${subject.slice(0, 90)} [#${n}]`, preview: body.slice(0, 90),
      title: "The E-Cinema team answered",
      body: `<div style="margin:0 0 20px;background:#f4f4f6;border-radius:10px;padding:16px;font:15px/1.6 Manrope,Arial,sans-serif;color:#1a1a20;white-space:pre-wrap">${esc(body)}</div>` +
        button(href(`/help/r/${token}`), closed ? "See the conversation" : "Reply") +
        small(closed ? "We marked this request as solved. If it is not, open it and reply; it opens again." : "To answer, open your request with the button above. Replies to this email are not read."),
      text: `The E-Cinema team answered your request #${n} (${subject}):\n\n${body}\n\nReply here: ${href(`/help/r/${token}`)}`,
    });
  },
  support_new: (m) => {
    const subject = S(m.data.subject), n = N(m.data.number);
    if (!subject || !n) return null;
    return done({
      from: SENDER.support, tag: "SUPPORT DESK", footer: { html: "You get this as E-Cinema staff on the support desk." },
      subject: `[#${n}] ${subject.slice(0, 90)}`, preview: `${S(m.data.from)} · ${S(m.data.topic)}`,
      title: "A new message for the support desk",
      body: facts([["From", S(m.data.from)], ["Topic", S(m.data.topic)], ["About", subject]]) +
        `<div style="margin:0 0 20px;background:#f4f4f6;border-radius:10px;padding:16px;font:14px/1.6 Manrope,Arial,sans-serif;color:#1a1a20;white-space:pre-wrap">${esc(S(m.data.body))}</div>` +
        button(href(`/support/desk?id=${n}`), "Answer on the desk"),
      text: `New support message #${n} from ${S(m.data.from)} (${S(m.data.topic)}): ${subject}\n\n${S(m.data.body)}\n\n${href(`/support/desk?id=${n}`)}`,
    });
  },
  // Error alert to the CEO and CTO: a crash viewers or the servers hit (no Figma frame; internal mail).
  error_alert: (m) => {
    const message = S(m.data.message), source = S(m.data.source);
    if (!message || !source) return null;
    const WHERE: Record<string, string> = { browser: "a viewer's browser", web: "the web server", api: "the API" };
    const count = N(m.data.count);
    const stack = S(m.data.stack);
    return done({
      from: SENDER.exec, tag: "ERROR ALERT", footer: { html: "You get this as an E-Cinema executive with access to Infrastructure." },
      subject: `Error on E-Cinema: ${message.slice(0, 80)}`, preview: `${WHERE[source] ?? source} · ${S(m.data.path) || "unknown page"}`,
      title: count > 1 ? "An error came back" : "A new error on E-Cinema",
      body: p(`It happened in ${esc(WHERE[source] ?? source)}${S(m.data.path) ? ` on <b>${esc(S(m.data.path))}</b>` : ""}.`) +
        facts([["Error", message], ["Times seen", String(Math.max(1, count))], ...(S(m.data.release) ? [["Version", S(m.data.release).slice(0, 7)] as [string, string]] : [])]) +
        (stack ? `<pre style="margin:0 0 20px;background:#f4f4f6;border-radius:10px;padding:14px;font:12px/1.5 Menlo,Consolas,monospace;color:#3a3a42;white-space:pre-wrap;word-break:break-word">${esc(stack.split("\n").slice(0, 12).join("\n"))}</pre>` : "") +
        p("You will not get another email about this one for six hours, unless it is marked fixed and comes back.") +
        button(href("/executive/infra#errors"), "Open Infrastructure"),
      text: `Error on E-Cinema (${source}${S(m.data.path) ? `, ${S(m.data.path)}` : ""}): ${message}. Seen ${Math.max(1, count)} times. ${href("/executive/infra#errors")}`,
    });
  },
  studio_incident: (m) => {
    const film = S(m.data.film), title = S(m.data.title), mins = N(m.data.minutes);
    if (!film || !title) return null;
    return done({
      from: SENDER.studios, tag: "INCIDENT", footer: FOOT_STUDIO(),
      subject: `Streaming problem during ${film}`, preview: title,
      title: "A problem hit your screening",
      body: p(`Our engineers logged a streaming problem during ${esc(film)}: ${esc(title.replace(/[.!]?$/, "."))}`) +
        (S(m.data.note) ? small(esc(S(m.data.note))) : "") +
        facts([["Film", film], ...(mins > 0 ? [["Picture lost for", `${mins} ${mins === 1 ? "minute" : "minutes"}`] as [string, string]] : [])]) +
        p("Every ticket holder who was watching gets a free seat on E-Cinema to make up for it.") +
        button(href("/studio/control"), "Open control room"),
      text: `Streaming problem during ${film}: ${title}. Viewers who were watching get a free seat. ${href("/studio/control")}`,
    });
  },
  studio_leak: (m) => {
    const PLACES: Record<string, string> = { website: "a website", telegram: "Telegram", tiktok: "TikTok", youtube: "YouTube", x: "X", instagram: "Instagram", facebook: "Facebook", whatsapp: "WhatsApp", other: "another site" };
    const KINDS: Record<string, string> = { clip: "A clip", full: "The full film", screenshot: "A screenshot", other: "Part" };
    const film = S(m.data.film), place = PLACES[S(m.data.place)], what = KINDS[S(m.data.what)];
    if (!place || !what) return null;
    return done({
      from: SENDER.studios, tag: "LEAK FOUND", footer: FOOT_STUDIO(),
      subject: `Leak found${film ? `: ${film}` : ""} on ${place.replace(/^a /, "")}`, preview: "Send a takedown and trace who shared it",
      title: "A leak was reported",
      body: p(`${what} of ${film ? esc(film) : "one of your films"} was reported on ${esc(place)}. Open Piracy protection to send the takedown notice and trace the viewer code in the picture.`) +
        button(href("/studio/piracy"), "Open Piracy protection"),
      text: `${what} of ${film || "one of your films"} was reported on ${place}. ${href("/studio/piracy")}`,
    });
  },
  studio_weekly: (m) => {
    const from = S(m.data.from), to = S(m.data.to), seats = N(m.data.seats), leaks = N(m.data.openLeaks);
    if (!from || !to) return null;
    const day = (d: string) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${d}T00:00:00Z`));
    const range = `${day(from)} to ${day(to)}`;
    const rows: [string, string][] = [
      ["Seats sold", seats.toLocaleString("en-GB")],
      ["Gross tickets", money(N(m.data.grossCents), "USD")],
      ["Your share", money(N(m.data.shareCents), "USD")],
      ["Countries", N(m.data.countries).toLocaleString("en-GB")],
    ];
    if (S(m.data.topFilm)) rows.push(["Best seller", `${S(m.data.topFilm)} · ${N(m.data.topSeats).toLocaleString("en-GB")} seats`]);
    rows.push(["Open leaks", leaks ? leaks.toLocaleString("en-GB") : "None"]);
    return done({
      from: SENDER.studios, tag: "WEEKLY REPORT", footer: FOOT_STUDIO(),
      subject: `Your week on E-Cinema: ${seats.toLocaleString("en-GB")} ${seats === 1 ? "seat" : "seats"} sold`, preview: range,
      title: `Your week, ${range}`,
      body: facts(rows) + button(href("/studio/analytics"), "Open analytics"),
      text: `${range}: ${seats} seats sold, ${money(N(m.data.shareCents), "USD")} to you. ${href("/studio/analytics")}`,
    });
  },

  // 35 Report received (127:259)
  report_received: (m) => done({
    from: SENDER.rewards, tag: "REPORT RECEIVED", footer: FOOT_ACTION(),
    subject: "We got your report about a fake seller", preview: "An investigator will check within 5 working days",
    title: "Thank you for your report",
    body: p(`We received your report about ${S(m.data.selling) ? `“${esc(S(m.data.selling))}”` : "a seller"}${S(m.data.place) ? ` on ${esc(S(m.data.place))}` : ""}. An investigator checks it within 5 working days. Your name is never shared with the seller. Report number:`) +
      refBox(S(m.data.report)) + button(href("/rewards"), "Track my report"),
    text: `We got your report ${S(m.data.report)}. Track it: ${href("/rewards")}`,
  }),

  // 24 Report reward paid (118:2917)
  report_paid: (m) => {
    const ngn = N(m.data.rewardNgn);
    const reward = ngn ? money(ngn * 100, "NGN") : "";
    return done({
      from: SENDER.rewards, tag: "REWARD PAID", footer: FOOT_ACTION(),
      subject: reward ? `Your report was confirmed: ${reward} paid` : "Your report was confirmed", preview: "Thank you for protecting E-Cinema",
      title: "Your report stopped a fake seller",
      body: p(`Our investigator confirmed the seller${S(m.data.place) ? ` on ${esc(S(m.data.place))}` : ""} was not licensed.${reward ? ` We paid ${esc(reward)}` : ""}${N(m.data.points) ? `${reward ? " and" : " We added"} ${N(m.data.points)} points` : ""}${reward || N(m.data.points) ? " to your wallet." : ""} Your name was never shared. Report number:`) +
        refBox(S(m.data.report)) + button(href("/rewards"), "See my rewards"),
      text: `Your report ${S(m.data.report)} was confirmed. ${href("/rewards")}`,
    });
  },

  // 36 Report not confirmed (127:281)
  report_closed: (m) => done({
    from: SENDER.rewards, tag: "NOT CONFIRMED", footer: FOOT_ACTION(),
    subject: "Your report could not be confirmed", preview: "No reward this time, and no penalty",
    title: "We could not confirm this one",
    body: p("There was not enough proof this time, so this report is closed with no reward. Honest reports never cost points. Report number:") +
      refBox(S(m.data.report)) + button(href("/rewards"), "See my reports"),
    text: `Your report ${S(m.data.report)} could not be confirmed. ${href("/rewards")}`,
  }),

  // 37 Licence application received (127:303)
  licence_received: (m) => done({
    from: SENDER.licensing, tag: "APPLICATION", footer: FOOT_ACTION(),
    subject: "We got your licence application", preview: "We review it within 10 working days",
    title: `Thanks for applying${S(m.data.company) ? `, ${S(m.data.company)}` : ""}`,
    body: p("We are checking your company papers, a sample of your printing and your shop locations. We reply within 10 working days. You cannot sell E-Cinema merch until it is approved. Application:") +
      refBox(S(m.data.app)) + button(href("/licensing/apply"), "See my application"),
    text: `We got your licence application ${S(m.data.app)}. ${href("/licensing/apply")}`,
  }),

  // 38 Licence needs changes (127:325)
  licence_changes: (m) => done({
    from: SENDER.licensing, tag: "CHANGES NEEDED", footer: FOOT_ACTION(),
    subject: "Your licence application needs changes", preview: S(m.data.note).slice(0, 90) || "Upload what is missing in your portal",
    title: "Almost there",
    body: p(`${esc(S(m.data.note) || "We need a few more documents.")} Update your application and we will finish the review. Application:`) +
      refBox(S(m.data.app)) + button(href("/licensing/apply"), "Upload documents"),
    text: `Your licence application needs changes: ${S(m.data.note)}. ${href("/licensing/apply")}`,
  }),

  // 25 Licence approved (118:2939)
  licence_approved: (m) => {
    const plan = S(m.data.plan), company = S(m.data.company);
    return done({
      from: SENDER.licensing, tag: "LICENCE APPROVED", footer: FOOT_ACTION(),
      subject: "Your E-Cinema merch licence is approved", preview: "Your licensee portal is ready",
      title: `Welcome${company ? `, ${company}` : ""}`,
      body: p(`You can now sell official E-Cinema merch${S(m.data.country) ? ` in ${esc(countryLabel(S(m.data.country)))}` : ""}${plan ? ` on the ${esc(plan[0].toUpperCase() + plan.slice(1))} plan` : ""}. Submit each product for approval before printing, and use our authenticity labels on every item. Licence number:`) +
        refBox(S(m.data.licence)) + button(href("/partner"), "Open my portal"),
      text: `Your E-Cinema merch licence ${S(m.data.licence)} is approved. ${href("/partner")}`,
    });
  },

  // 39 Product design approved (127:347)
  design_approved: (m) => done({
    from: SENDER.licensing, tag: "DESIGN APPROVED", footer: FOOT_ACTION(),
    subject: `Approved: ${S(m.data.product)}`, preview: "You can start printing",
    title: "Your design is approved",
    body: p(`${esc(S(m.data.product))} is approved. Order authenticity labels before printing; every item must carry one. Design number:`) +
      refBox(S(m.data.design)) + button(href("/partner/codes"), "Order labels"),
    text: `${S(m.data.product)} is approved. Order labels: ${href("/partner/codes")}`,
  }),

  // 40 Product design rejected (127:369)
  design_rejected: (m) => done({
    from: SENDER.licensing, tag: S(m.data.status) === "changes" ? "CHANGES NEEDED" : "NOT APPROVED", footer: FOOT_ACTION(),
    subject: `Not approved: ${S(m.data.product)}`, preview: S(m.data.note).slice(0, 90),
    title: "This design needs fixing",
    body: p(`${esc(S(m.data.note))} Use the brand kit in your portal, then submit again. Nothing is charged for a resubmission. Design number:`) +
      refBox(S(m.data.design)) + button(href("/partner/products"), "Open my products"),
    text: `${S(m.data.product)} was not approved: ${S(m.data.note)}. ${href("/partner/products")}`,
  }),

  // 42 Licence renewal due (127:413)
  licence_renewal: (m) => {
    const until = S(m.data.validUntil);
    if (!until) return null;
    const day = new Date(`${until.slice(0, 10)}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "long", timeZone: "UTC" });
    return done({
      from: SENDER.licensing, tag: "RENEW", footer: FOOT_ACTION(),
      subject: "Your licence ends in 30 days", preview: "Renew to keep selling without a break",
      title: "Time to renew your licence",
      body: p(`Your ${esc(S(m.data.plan))} licence ends on ${esc(day)}. Renew now to keep your products, codes and shop listings live. Licence:`) +
        refBox(S(m.data.licence)) + button(href("/partner/licence"), "Renew licence"),
      text: `Your licence ${S(m.data.licence)} ends on ${day}. Renew: ${href("/partner/licence")}`,
    });
  },

  // 41 Monthly royalty statement (127:391). Queued by the API from 08:00 UTC on the 1st for
  // partners who owe a royalty for last month; "Pay now" opens that month in the portal.
  royalty_statement: (m) => {
    const month = S(m.data.month), invoice = S(m.data.invoice), due = S(m.data.dueBy);
    const sales = N(m.data.salesNgn), royalty = N(m.data.royaltyNgn), pct = N(m.data.pct);
    if (!/^\d{4}-\d{2}$/.test(month) || !royalty || !due) return null;
    const mon = new Date(`${month}-01T00:00:00Z`).toLocaleDateString("en-GB", { month: "long", timeZone: "UTC" });
    const dueDay = new Date(`${due}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "long", timeZone: "UTC" });
    const ngn = (n: number) => `₦${Math.round(n).toLocaleString("en-NG")}`;
    const short = (n: number) => n >= 1e6 ? `₦${(n / 1e6).toFixed(1).replace(/\.0$/, "")}M` : n >= 1e3 ? `₦${Math.round(n / 1e3)}k` : ngn(n);
    return done({
      from: SENDER.billing, tag: "STATEMENT", footer: FOOT_ACTION(),
      subject: `${mon} royalty statement: ${short(royalty)} due`, preview: `Pay by ${dueDay} to stay in good standing`,
      title: `Your ${mon} statement`,
      body: p(`You sold ${short(sales)} of E-Cinema merch in ${mon}. Your ${esc(S(m.data.plan))} plan royalty is ${pct}%, so ${ngn(royalty)} is due by ${dueDay}. Pay in your portal by card or PayPal. Invoice:`) +
        bigCode(invoice) + button(href(`/partner/royalties?pay=${month}`), "Pay now"),
      text: `You sold ${short(sales)} of E-Cinema merch in ${mon}. Your ${S(m.data.plan)} plan royalty is ${pct}%, so ${ngn(royalty)} is due by ${dueDay}. Invoice ${invoice}. Pay now: ${href(`/partner/royalties?pay=${month}`)}`,
    });
  },

  // 43 Compliance warning (127:435). Queued when the brand team opens a compliance case on the
  // licensing desk after a market check.
  compliance_warning: (m) => {
    const num = S(m.data.case), issue = S(m.data.issue), place = S(m.data.place), finding = S(m.data.finding), fixBy = S(m.data.fixBy);
    if (!/^CMP-\d{4,}$/.test(num) || !issue || !finding || !fixBy) return null;
    const days = Math.max(1, Math.floor((Date.parse(`${fixBy}T23:59:59Z`) - Date.now()) / 86_400_000));
    const end = finding.trim().replace(/[.!]?$/, ".");
    return done({
      from: SENDER.licensing, tag: "WARNING", footer: FOOT_ACTION(),
      subject: `Warning: ${issue} found${place ? ` in ${place}` : ""}`, preview: `Fix within ${days} ${days === 1 ? "day" : "days"} to avoid suspension`,
      title: "We found a problem",
      body: p(`${esc(end)} Fix it within ${days} ${days === 1 ? "day" : "days"}, or your licence is suspended. Case number:`) +
        bigCode(num) + button(href(`/partner/licence#${num}`), "See the case"),
      text: `${end} Fix it within ${days} ${days === 1 ? "day" : "days"}, or your licence is suspended. Case ${num}: ${href(`/partner/licence#${num}`)}`,
    });
  },

  // 44 Studio film needs changes (127:457). Queued by the API when a film with a premiere ahead
  // has quality-check problems; a new problem sends a new email.
  film_changes: (m) => {
    const film = S(m.data.film), code = S(m.data.code), upload = S(m.data.upload);
    const issues = Array.isArray(m.data.issues) ? (m.data.issues as unknown[]).map(S).filter(Boolean).slice(0, 8) : [];
    if (!film || !code || !/^[0-9a-f-]{36}$/.test(upload) || !issues.length) return null;
    const n = issues.length, word = ["one fix", "two fixes", "three fixes", "four fixes", "five fixes"][n - 1] ?? `${n} fixes`;
    const sentence = (t: string) => t.charAt(0).toUpperCase() + t.slice(1).replace(/[.!]?$/, ".");
    return done({
      from: SENDER.studios, tag: "CHANGES NEEDED", footer: FOOT_ACTION(),
      subject: `${film} needs ${word} before release`, preview: n === 1 ? sentence(issues[0]).slice(0, 90) : `${n} things to fix before your premiere`,
      title: "Your film is almost ready",
      body: (n === 1
        ? p(`Our checks found one thing to fix: ${esc(sentence(issues[0]))} Fix it in the Studio portal to keep your premiere date. Film:`)
        : p("Our checks found these to fix:") + steps(issues.map(sentence)) + p("Fix them in the Studio portal to keep your premiere date. Film:")) +
        bigCode(code) + button(href(`/studio/films/${upload}`), "Open Studio portal"),
      text: `Our checks found ${n === 1 ? "one thing" : `${n} things`} to fix in ${film} (${code}): ${issues.map(sentence).join(" ")} Fix ${n === 1 ? "it" : "them"} in the Studio portal to keep your premiere date: ${href(`/studio/films/${upload}`)}`,
    });
  },

  // 45 Executive invite expiring (127:479)
  exec_invite_expiring: (m) => {
    const token = S(m.data.token), ends = S(m.data.expiresAt);
    if (!token || !ends || Date.parse(ends) < Date.now()) return null;
    return done({
      from: SENDER.exec, tag: "INVITE", footer: FOOT_ACTION(),
      subject: "Your E-Cinema invite expires tomorrow", preview: "Sign in with a passkey to accept",
      title: "Your invite ends in 24 hours",
      body: p(`${esc(S(m.data.by) || "E-Cinema")} invited you to the E-Cinema executive dashboard. Accept before ${esc(when(ends, m.country, { zone: true }))} by confirming your email, a face check and a passkey.`) +
        button(href(`/invite/executive/${encodeURIComponent(token)}`), "Accept invite") +
        small("The link works once. If it runs out, ask for a new one."),
      text: `Your E-Cinema invite ends ${when(ends, m.country, { zone: true })}. Accept: ${href(`/invite/executive/${token}`)}`,
    });
  },

  // 34 Account restored (127:237)
  account_restored: () => done({
    from: SENDER.security, tag: "RESTORED",
    subject: "Welcome back, your account is restored", preview: "Deletion cancelled, everything is where you left it",
    title: "Your account is back",
    body: p("You signed in before the deletion date, so we cancelled it. Your tickets, wallet, friends and history are all here.") +
      button(href("/home"), "Open E-Cinema") +
      small("Did not sign in yourself? Change your password and sign out all devices in Settings."),
    text: `Your account is restored. ${href("/home")}`,
  }),

  // 11 Payment receipt (106:332)
  plan_receipt: (m) => {
    const plan = PLAN[S(m.data.plan)] ?? "E-Cinema";
    const amount = major(S(m.data.amount), S(m.data.currency));
    const next = S(m.data.renewsAt);
    return done({
      from: SENDER.billing, tag: "RECEIPT",
      subject: `Receipt: ${plan} plan${amount ? `, ${amount}` : ""}`, preview: `Paid ${new Date().toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}`,
      title: "Thanks for your payment",
      body: facts([
        ["Plan", plan],
        ...(amount ? [["Amount", `${amount} incl. VAT`] as [string, string]] : []),
        ["Paid with", "PayPal"],
        ...(next && Date.parse(next) > Date.now() ? [["Next renewal", dayName(next, m.country)] as [string, string]] : []),
        ["Receipt", S(m.data.receipt)],
      ]) + button(href("/settings/plan"), "See plan and payments"),
      text: `Receipt ${S(m.data.receipt)}: ${plan} plan ${amount}. ${href("/settings/plan")}`,
    });
  },

  // 12 Payment failed (106:353)
  plan_failed: (m) => {
    const plan = PLAN[S(m.data.plan)] ?? "E-Cinema";
    const amount = major(S(m.data.amount), S(m.data.currency));
    return done({
      from: SENDER.billing, tag: "BILLING",
      subject: `We could not renew your ${plan} plan`, preview: "Update your payment to keep your plan",
      title: "Your payment did not go through",
      body: p(`PayPal could not take ${amount ? esc(amount) + " " : "the payment "}for ${esc(plan)}. PayPal will try again; update the card or bank in your PayPal account to keep your plan.`) +
        button(href("/settings/plan"), "Update payment") +
        small("You can also switch plans or pay with another method in Plan and payments."),
      text: `We could not renew your ${plan} plan. Update payment: ${href("/settings/plan")}`,
    });
  },
  // 22 We miss you, a free seat to come back (106:657). Queued on Wednesdays for members who have
  // not booked in 60 days; the seat is already in their credit.
  winback: (m) => {
    const film = S(m.data.film), at = S(m.data.startsAt), code = S(m.data.code), friend = S(m.data.friend), n = N(m.data.friends);
    if (!film || !at || !code) return null;
    const day = new Intl.DateTimeFormat("en-GB", { weekday: "long", timeZone: zoneOf(m.country) }).format(new Date(at));
    const others = n - 1;
    const lead = friend
      ? `${esc(friend)}${others > 0 ? ` and ${others} ${others === 1 ? "friend" : "friends"}` : ""} ${n > 1 ? "have" : "has"} a room for ${esc(film)} on ${esc(day)}.`
      : `${esc(film)} premieres on ${esc(day)} at ${clock(at, m.country)} your time.`;
    return done({
      from: SENDER.hello, tag: "COME BACK", footer: FOOT_NEWS(), news: true,
      subject: friend ? `${friend} is going to ${film}. Come too, free` : `${film} on ${day}, and your seat is free`,
      preview: "Here is a free seat to come back",
      title: "Come back for a free seat",
      body: p(`${lead} Your next premiere is on us.`) + refBox(code) +
        button(href(`/checkout?film=${encodeURIComponent(S(m.data.showtimeId))}`), "Use my free seat") +
        small("The seat is already in your E-Cinema credit. It pays for any premiere and never runs out."),
      text: `${friend ? `${friend} has a room for ${film} on ${day}.` : `${film} premieres on ${day}.`} Your next premiere is on us: a free seat is in your E-Cinema credit (code ${code}), good for any premiere. ${href("/browse")}`,
    });
  },

  // 31 Stream problem, credit added (127:171). Queued when an executive logs an outage on a screening.
  outage_credit: (m) => {
    const film = S(m.data.film), from = S(m.data.from), to = S(m.data.to), code = S(m.data.code);
    if (!film || !from || !to || !code) return null;
    const mins = Math.max(1, Math.round((Date.parse(to) - Date.parse(from)) / 60_000));
    return done({
      from: SENDER.tickets, tag: "OUR FAULT", footer: FOOT_ACTION(),
      subject: `Sorry about the break in ${film}`, preview: "A free seat is in your wallet",
      title: `We let you down for ${mins} ${mins === 1 ? "minute" : "minutes"}`,
      body: p(`You lost the picture in ${esc(film)} from ${clock(from, m.country)} to ${clock(to, m.country)}. That should never happen. We added a free seat to your E-Cinema credit, good for any premiere. Credit code:`) +
        refBox(code) + button(href("/browse"), "Use my free seat"),
      text: `You lost the picture in ${film} from ${clock(from, m.country)} to ${clock(to, m.country)}. We added a free seat to your E-Cinema credit, good for any premiere. Credit code ${code}. ${href("/browse")}`,
    });
  },
  // 28 Ticket opened on another device (127:105). Queued by the API when a second device tries
  // to play a seat that is already playing (one device per paid seat).
  second_device: (m) => {
    const film = S(m.data.film), device = S(m.data.device), playing = S(m.data.playing);
    if (!film) return null;
    return done({
      from: SENDER.security, tag: "ONE DEVICE", footer: FOOT_ACTION(),
      subject: "Your ticket was opened on a second device", preview: "We stopped it. Was this you?",
      title: "We blocked a second device",
      body: p(`Someone tried to play your ${esc(film)} ticket on ${esc(device || "another device")} while it was playing on ${esc(playing || "your other device")}. A ticket plays on one device only, so we blocked it. Device code:`) +
        refBox(S(m.data.code)) + button(href("/account/devices"), "This was not me") +
        small("If it was you, close the film on the first device and open it again on the new one."),
      text: `Someone tried to play your ${film} ticket on ${device || "another device"} while it was playing on ${playing || "your other device"}. A ticket plays on one device only, so we blocked it. Device code ${S(m.data.code)}. Not you? Sign that device out: ${href("/account/devices")}`,
    });
  },

  // 33 Account locked for safety (127:215). Queued by the API when five face checks fail
  // within 10 minutes; the code and a new face check on /unlock lift the lock.
  account_locked: (m) => {
    const code = S(m.data.code), place = S(m.data.place), email = S(m.data.email) || m.to;
    if (!/^\d{6}$/.test(code)) return null;
    const from = place ? `from a device in ${place}` : "from one device";
    return done({
      from: SENDER.security, tag: "LOCKED", footer: FOOT_ACTION(),
      subject: "We locked your account for your safety", preview: "Five face checks failed in 10 minutes",
      title: "Your account is locked",
      body: p(`Five face checks failed ${esc(from)}. Nobody can sign in until you confirm it is you with a new face check and the code below. Your tickets and wallet are safe. Code:`) +
        bigCode(code) + button(href(`/unlock-account?email=${encodeURIComponent(email)}`), "Unlock my account"),
      text: `Five face checks failed ${from}. Nobody can sign in until you confirm it is you with a new face check and this code: ${code}. Your tickets and wallet are safe. ${href("/unlock-account")}`,
    });
  },
};

// Facts an email cannot go out without (the rest check inside their template).
const NEEDS: Record<string, string[]> = {
  report_received: ["report"], report_paid: ["report"], report_closed: ["report"],
  licence_received: ["app"], licence_changes: ["app", "note"], licence_approved: ["licence"],
  design_approved: ["design", "product"], design_rejected: ["design", "product", "note"],
  licence_renewal: ["licence"], late_ticket: ["ticket"], not_joined: ["ticket"], preorder_week: ["ticket"],
  gift_waiting: ["gift"], refund: ["what"], premiere_moved: ["ticket"], premiere_cancelled: ["ref"], winback: ["code"], outage_credit: ["code"], second_device: ["code"], account_locked: ["code"], royalty_statement: ["invoice"], compliance_warning: ["case"], film_changes: ["code"], plan_receipt: ["receipt"], studio_payout: ["shareMinor"], studio_milestone: ["film"], studio_incident: ["film"], studio_leak: ["place"], studio_weekly: ["from"],
};

export const mailKinds = () => Object.keys(T);
export function renderMail(m: Outgoing): Rendered | null {
  const t = T[m.kind];
  if (!t || (NEEDS[m.kind] ?? []).some((k) => !S(m.data?.[k]))) return null;
  try {
    return t({ ...m, data: m.data ?? {} });
  } catch {
    return null;
  }
}
