"use client";
import Link from "next/link";
import ProductArt from "@/components/store/ProductArt";
import { useState } from "react";
import { price, type Order, type Pricing } from "@/lib/store-types";

type Verdict = { instant: boolean; why: string } | { blocked: string };
type Refund = { id: string; reason: string; note: string; outcome: "refund" | "replace"; status: "approved" | "review" | "declined"; amountNgn: number; createdAt: string };
export type RefundInfo = { order: Order; refund: Refund | null; verdicts: Record<string, Verdict>; late: boolean };

const REASONS: [string, string][] = [["late", "Arrived late"], ["wrong", "Wrong item"], ["damaged", "Damaged"], ["never", "Never arrived"]];

export default function RefundForm({ info, px, tz }: { info: RefundInfo; px: Pricing; tz: string }) {
  const o = info.order;
  const first = REASONS.find(([k]) => "instant" in info.verdicts[k] && (k !== "late" || info.late))?.[0] ?? REASONS.find(([k]) => "instant" in info.verdicts[k])?.[0] ?? "";
  const [reason, setReason] = useState(first);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const [done, setDone] = useState<{ refund: Refund; refunded: boolean } | null>(info.refund ? { refund: info.refund, refunded: false } : null);
  const total = price(o.totalNgn, px);
  const time = (iso?: string) => (iso ? new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: tz }).format(new Date(iso)) : "");
  const when = o.status === "out" ? `out with the rider since ${time(o.outAt)}` : `delivered ${time(o.deliveredAt)}${info.late ? ", after the premiere started" : ""}`;
  const v = info.verdicts[reason];
  const payTo = o.method === "paypal" ? `your ${o.chargeCurrency} PayPal payment` : "your E-Cinema wallet";

  async function send(outcome: "refund" | "replace") {
    setBusy(outcome); setErr("");
    const r = await fetch(`/api/store/orders/${o.id}/refund`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ reason, note, outcome }) });
    const b = await r.json().catch(() => ({}));
    setBusy("");
    if (!r.ok) { setErr(b.error ?? "Something went wrong. Try again."); return; }
    setDone(b);
  }

  const head = (
    <div className="rf-order">
      <span className="rf-img">{o.items[0] && <ProductArt id={o.items[0].productId} name={o.items[0].name} images={o.items[0].images} size={24} />}</span>
      <span><b>{o.items.map((i) => i.name).join(", ")}</b><small>Order {o.number} · {when}</small></span>
      <em>{total}</em>
    </div>
  );

  if (done) {
    const f = done.refund;
    const msg = f.status === "declined" ? "The delivery team looked at this and could not offer a refund. Talk to Help if you think that is wrong."
      : f.status === "review" ? `The delivery team is checking this ${f.outcome === "replace" ? "replacement" : "refund"} and will message you, usually within a day.`
      : f.outcome === "replace" ? "Approved. A replacement is being packed and you can follow it in your orders."
      : o.method === "paypal" ? `Approved. ${total} goes back to ${payTo} in 1 to 5 working days.`
      : `Approved. ${total} is in your E-Cinema wallet now.`;
    return (
      <div className="rf-card">
        <h1>{f.status === "approved" ? "Sorted" : f.status === "review" ? "We are on it" : "Request closed"}</h1>
        {head}
        <p className={`rf-note ${f.status === "approved" ? "ok" : f.status === "declined" ? "bad" : ""}`} role="status">{msg}</p>
        <div className="rf-btns">
          <Link className="vf-btn red" href={`/shop/orders?o=${o.id}`}>Back to my orders</Link>
          <Link className="vf-btn ghost" href="/help">Talk to Help</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="rf-card">
      <h1>Request a refund</h1>
      {head}
      <h2>What went wrong?</h2>
      <div className="rf-chips" role="radiogroup" aria-label="What went wrong?">
        {REASONS.map(([k, t]) => {
          const blocked = "blocked" in info.verdicts[k];
          return <button key={k} type="button" role="radio" aria-checked={reason === k} className={reason === k ? "on" : ""} disabled={blocked} onClick={() => setReason(k)}>{t}</button>;
        })}
      </div>
      <label className="rf-label" htmlFor="rf-note">Tell us more (optional)</label>
      <textarea id="rf-note" className="rf-text" rows={3} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Rider arrived 11 minutes after the film started." />
      {v && ("blocked" in v
        ? <p className="rf-note bad">{v.blocked}</p>
        : <p className={`rf-note ${v.instant ? "ok" : ""}`}>{v.instant ? `This qualifies for an instant refund under our refund rules. ${total} goes back to ${payTo}${o.method === "paypal" ? " in 1 to 5 working days" : " straight away"}.` : `${v.why} You will hear back from us.`} <Link href="/refunds">Refund rules</Link></p>)}
      {err && <p className="rf-note bad" role="alert">{err}</p>}
      <div className="rf-btns">
        <button type="button" className="vf-btn red" disabled={!reason || Boolean(busy) || (v && "blocked" in v)} onClick={() => send("refund")}>{busy === "refund" ? "Sending" : `Refund ${total}`}</button>
        <button type="button" className="vf-btn ghost" disabled={!reason || Boolean(busy) || (v && "blocked" in v)} onClick={() => send("replace")}>{busy === "replace" ? "Sending" : "Get a replacement instead"}</button>
      </div>
    </div>
  );
}
