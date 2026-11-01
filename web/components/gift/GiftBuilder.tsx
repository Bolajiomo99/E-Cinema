"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import PayPalTicketButton from "@/components/PayPalTicketButton";

export type GiftShow = { id: string; film: string; startsAt: string; cents: number; currency: string };
type Kind = "seat" | "pro1" | "vip3" | "credit";
const KINDS: [Kind, string][] = [["seat", "A premiere seat"], ["pro1", "1 month of Pro"], ["vip3", "3 months of VIP"], ["credit", "Credit"]];
const CHIPS = [500, 1000, 2500];

const fmt = (cents: number, cur = "USD") => (cur === "USD" ? `$${(cents / 100).toFixed(2).replace(/\.00$/, "")}` : `${cur} ${(cents / 100).toFixed(2)}`);
const isEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
const isPhone = (v: string) => /^\+?[0-9 ()-]{7,20}$/.test(v);
// <input type="datetime-local"> works in local time without a zone.
const localInput = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
const when = (iso: string) => new Date(iso).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

export default function GiftBuilder({ shows, prices, signedIn, initialFilm, initialKind }: {
  shows: GiftShow[]; prices: { pro1: number; vip3: number }; signedIn: boolean; initialFilm?: string; initialKind?: Kind;
}) {
  const [kind, setKind] = useState<Kind>(initialKind ?? (shows.length ? "seat" : "credit"));
  const [film, setFilm] = useState(shows.find((s) => s.id === initialFilm)?.id ?? shows[0]?.id ?? "");
  const [amount, setAmount] = useState<number | "other">(1000);
  const [other, setOther] = useState("");
  const [name, setName] = useState("");
  const [to, setTo] = useState("");
  const [message, setMessage] = useState("");
  // Times depend on the viewer's clock and zone, so they are filled in after hydration.
  const [deliver, setDeliver] = useState("");
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
    setDeliver(localInput(new Date()));
  }, []);

  const show = shows.find((s) => s.id === film);
  const cents = kind === "seat" ? show?.cents ?? 0 : kind === "pro1" ? prices.pro1 : kind === "vip3" ? prices.vip3 : amount === "other" ? Math.round(Number(other) * 100) || 0 : amount;
  const currency = kind === "seat" ? show?.currency ?? "USD" : "USD";
  const deliverAt = deliver ? new Date(deliver) : new Date();
  const problem = useMemo(() => {
    if (kind === "seat" && !show) return "There is no premiere to gift right now. Give credit instead.";
    if (kind === "credit" && (cents < 100 || cents > 50000)) return "Credit can be $1 to $500.";
    if (!name.trim()) return "Add their name.";
    if (!isEmail(to.trim()) && !isPhone(to.trim())) return "Add their email or WhatsApp number.";
    if (Number.isNaN(deliverAt.getTime())) return "Pick when it arrives.";
    if (kind === "seat" && show && deliverAt.getTime() >= Date.parse(show.startsAt)) return "Pick a delivery time before the premiere starts.";
    return "";
  }, [kind, show, cents, name, to, deliverAt]);

  const first = name.trim().split(" ")[0];
  const now = deliverAt.getTime() <= Date.now() + 60_000;
  const by = isPhone(to.trim()) && !isEmail(to.trim()) ? "a link we email you to send on WhatsApp" : "email";
  const what = kind === "seat" ? `1 premiere seat for ${show?.film ?? "a premiere"}` : kind === "credit" ? `${fmt(cents)} of credit` : kind === "pro1" ? "1 month of Pro" : "3 months of VIP";

  async function create() {
    const r = await fetch("/api/gifts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind, showtimeId: kind === "seat" ? film : undefined, amountCents: kind === "credit" ? cents : undefined, name: name.trim(), to: to.trim(), message: message.trim(), deliverAt: deliverAt.toISOString() }),
    });
    const body = (await r.json().catch(() => ({}))) as { orderId?: string; error?: string };
    if (!r.ok || !body.orderId) throw new Error(body.error ?? "Could not start the payment. Please try again.");
    return body.orderId;
  }

  return (
    <div className="gf-build">
      <form className="gf-form" onSubmit={(e) => e.preventDefault()}>
        <p className="gf-label">What to give</p>
        <div className="gf-chips" role="radiogroup" aria-label="What to give">
          {KINDS.map(([k, label]) => (
            <button key={k} type="button" role="radio" aria-checked={kind === k} className={kind === k ? "on" : ""} onClick={() => setKind(k)}>{label}</button>
          ))}
        </div>

        {kind === "seat" && (
          <>
            <p className="gf-label">Premiere</p>
            {shows.length ? (
              <select className="gf-input" value={film} onChange={(e) => setFilm(e.target.value)} aria-label="Premiere">
                {shows.map((s) => <option key={s.id} value={s.id}>{s.film}{mounted ? ` · ${when(s.startsAt)}` : ""} · {fmt(s.cents, s.currency)}</option>)}
              </select>
            ) : <p className="gf-note">No premieres are open right now.</p>}
          </>
        )}
        {kind === "credit" && (
          <>
            <p className="gf-label">Amount</p>
            <div className="gf-chips" role="radiogroup" aria-label="Amount">
              {CHIPS.map((c) => <button key={c} type="button" role="radio" aria-checked={amount === c} className={amount === c ? "on" : ""} onClick={() => setAmount(c)}>{fmt(c)}</button>)}
              <button type="button" role="radio" aria-checked={amount === "other"} className={amount === "other" ? "on" : ""} onClick={() => setAmount("other")}>Other</button>
            </div>
            {amount === "other" && (
              <label className="gf-field"><span>Amount in US dollars</span>
                <input className="gf-input" inputMode="decimal" placeholder="15" value={other} onChange={(e) => setOther(e.target.value.replace(/[^0-9.]/g, ""))} />
              </label>
            )}
          </>
        )}
        {(kind === "pro1" || kind === "vip3") && (
          <p className="gf-note">{kind === "pro1" ? "Pro for one month: member prices, 4K seats and no ads." : "VIP for three months: the best seats, early rooms and member prices."} If they already pay for a plan, it becomes credit instead.</p>
        )}

        <div className="gf-row">
          <label className="gf-field"><span>Their name</span><input className="gf-input" value={name} maxLength={80} placeholder="Ada" onChange={(e) => setName(e.target.value)} autoComplete="off" /></label>
          <label className="gf-field"><span>Email or WhatsApp</span><input className="gf-input" value={to} placeholder="+44 7700 900123" onChange={(e) => setTo(e.target.value)} autoComplete="off" /></label>
        </div>
        <label className="gf-field"><span>Message</span><input className="gf-input" value={message} maxLength={280} placeholder="Happy birthday! Watch it with me on Friday." onChange={(e) => setMessage(e.target.value)} /></label>
        <label className="gf-field"><span>Deliver on</span><input className="gf-input" type="datetime-local" value={deliver} min={mounted ? localInput(new Date()) : undefined} onChange={(e) => setDeliver(e.target.value)} /></label>
      </form>

      <aside className="gf-sum">
        <h3>Summary</h3>
        <p>{what}{name.trim() ? ` for ${first}` : ""}, sent by {by} {now ? "as soon as you pay" : `on ${when(deliverAt.toISOString())}`}. It works in any country.</p>
        {problem && (name || to) ? <p className="gf-err" role="alert">{problem}</p> : null}
        {signedIn ? (
          <PayPalTicketButton key={`${kind}-${film}`} create={create} disabled={Boolean(problem)} label={`Pay ${fmt(cents, currency)}`} className="lp-btn gf-pay" onPaid={() => window.location.assign("/tickets?view=gifted&sent=1")} />
        ) : (
          <Link href="/signin?next=/gift" className="lp-btn gf-pay">Sign in to pay {fmt(cents, currency)}</Link>
        )}
        <small>PayPal and cards through PayPal. More local methods are coming soon.</small>
      </aside>
    </div>
  );
}
