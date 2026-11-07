import "server-only";
import { FONT, button, esc, facts, layout, p, site } from "@/lib/email";
import { marketOf } from "@/lib/premiere-types";
import { countryName as countryLabel, vatRate } from "@/lib/plans";

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
        small(`Something wrong? <a href="${esc(href(`/shop/orders?o=${encodeURIComponent(S(m.data.orderId))}`))}" style="color:#7a7a84">Return it</a> within 14 days.`),
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

};

// Facts an email cannot go out without (the rest check inside their template).
const NEEDS: Record<string, string[]> = {
  report_received: ["report"], report_paid: ["report"], report_closed: ["report"],
  licence_received: ["app"], licence_changes: ["app", "note"], licence_approved: ["licence"],
  design_approved: ["design", "product"], design_rejected: ["design", "product", "note"],
  licence_renewal: ["licence"], late_ticket: ["ticket"], not_joined: ["ticket"], preorder_week: ["ticket"],
  gift_waiting: ["gift"], refund: ["what"], premiere_moved: ["ticket"], premiere_cancelled: ["ref"], winback: ["code"], outage_credit: ["code"], second_device: ["code"], plan_receipt: ["receipt"], studio_payout: ["shareMinor"],
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
