"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import ProductArt from "@/components/store/ProductArt";
import { announce, store } from "@/lib/store-client";
import { price, RETURN_DAYS, type Order, type Pricing, type Quote } from "@/lib/store-types";

const ACTIVE = new Set(["placed", "packed", "out"]);
const RETURNS = new Set(["returning", "returned"]);
type Tab = "active" | "delivered" | "returns";

// Orders and tracking (Figma 89:894). Order changes arrive live over the account's socket.
export default function OrdersApp({ initial, reviewable, px, tz, focus, placed }: {
  initial: Order[]; reviewable: string[]; px: Pricing; tz: string; focus?: string; placed?: boolean;
}) {
  const [orders, setOrders] = useState(initial);
  const [tab, setTab] = useState<Tab>(() => {
    const f = initial.find((o) => o.id === focus);
    return f && RETURNS.has(f.status) ? "returns" : f && !ACTIVE.has(f.status) ? "delivered" : "active";
  });
  const [sel, setSel] = useState(focus ?? initial.find((o) => ACTIVE.has(o.status))?.id ?? initial[0]?.id);
  const selRef = useRef(sel);
  useEffect(() => { selRef.current = sel; }, [sel]);
  const [msg, setMsg] = useState(placed ? "Order placed. We will keep this page up to date as it moves." : "");
  const [now, setNow] = useState(() => Date.now());

  // Live: the same socket Messages uses pushes an "order" event when the team moves an order.
  useEffect(() => {
    let stop = false, ws: WebSocket | null = null, timer: ReturnType<typeof setTimeout> | undefined, tries = 0;
    const connect = async () => {
      if (stop) return;
      const r = await fetch("/api/chat/pass").then((x) => (x.ok ? x.json() : null)).catch(() => null);
      if (stop) return;
      if (!r?.pass || !r?.ws) { timer = setTimeout(connect, Math.min(30_000, 2000 * ++tries)); return; }
      ws = new WebSocket(`${r.ws}/v1/chat/live?t=${encodeURIComponent(r.pass)}`);
      ws.onopen = () => { tries = 0; };
      ws.onmessage = (m) => {
        try {
          const e = JSON.parse(m.data) as { type: string; order?: Order };
          if (e.type === "order" && e.order) {
            const o = e.order;
            setOrders((list) => (list.some((x) => x.id === o.id) ? list.map((x) => (x.id === o.id ? o : x)) : [o, ...list]));
            // Follow the order on screen into its new tab (delivered, returns).
            if (selRef.current === o.id) setTab(RETURNS.has(o.status) ? "returns" : ACTIVE.has(o.status) ? "active" : "delivered");
          }
        } catch {}
      };
      ws.onclose = () => { if (!stop) timer = setTimeout(connect, Math.min(30_000, 1000 * 2 ** tries++)); };
    };
    void connect();
    const tick = setInterval(() => setNow(Date.now()), 30_000);
    return () => { stop = true; clearTimeout(timer); clearInterval(tick); ws?.close(); };
  }, []);

  const shown = useMemo(() => orders.filter((o) => (tab === "active" ? ACTIVE.has(o.status) : tab === "returns" ? RETURNS.has(o.status) : !ACTIVE.has(o.status) && !RETURNS.has(o.status))), [orders, tab]);
  const current = orders.find((o) => o.id === sel && shown.includes(o)) ?? shown[0];
  const earlier = orders.filter((o) => o.id !== current?.id && !ACTIVE.has(o.status));
  const t = (iso?: string) => (iso ? new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: tz }) : "");
  const d = (iso: string) => {
    const x = new Date(iso);
    const today = new Date(now).toLocaleDateString("en-GB", { timeZone: tz }) === x.toLocaleDateString("en-GB", { timeZone: tz });
    return today ? `today ${t(iso)}` : x.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: tz });
  };
  const replace = (o: Order) => setOrders((list) => list.map((x) => (x.id === o.id ? o : x)));

  const act = async (o: Order, what: "cancel" | "return" | "reorder") => {
    setMsg("");
    let body: object = {};
    if (what === "return") {
      const reason = window.prompt(`Why are you returning order ${o.number}?`, "");
      if (!reason) return;
      body = { reason };
    }
    if (what === "cancel" && !window.confirm(`Cancel order ${o.number}?`)) return;
    const r = await store<{ order?: Order; refunded?: boolean } & Partial<Order> & Partial<Quote>>(`orders/${o.id}/${what}`, "POST", body);
    if (!r.ok) return setMsg(r.data.error ?? "That did not work. Try again.");
    if (what === "reorder") {
      announce(r.data as Quote);
      return window.location.assign("/shop/cart");
    }
    const next = (r.data.order ?? r.data) as Order;
    replace(next);
    setMsg(what === "cancel" ? (r.data.refunded ? `Cancelled. Your ${o.chargeCurrency} payment is being refunded.` : "Cancelled. Nothing to pay.") : "Return started. A rider will collect it.");
  };

  const rate = async (productId: string, stars: number) => {
    const r = await store(`reviews/${productId}`, "PUT", { stars, body: "" });
    setMsg(r.ok ? "Thanks, your rating is on the product page." : r.data.error ?? "Could not save your rating");
  };

  return (
    <>
      <div className="or-h">
        <div>
          <h1 className="ct-h1">Your orders</h1>
          <p className="sh-sub">Track deliveries live, reorder snacks for tonight, or return anything within {RETURN_DAYS} days.</p>
        </div>
        <div className="sh-chips" role="tablist">
          {(["active", "delivered", "returns"] as Tab[]).map((k) => (
            <button key={k} type="button" role="tab" aria-selected={tab === k} className={`sh-chip${tab === k ? " on" : ""}`} onClick={() => setTab(k)}>
              {k === "active" ? "Active" : k === "delivered" ? "Delivered" : "Returns"}
            </button>
          ))}
        </div>
      </div>
      {msg && <p className="or-msg" role="status">{msg}</p>}
      {orders.length === 0 ? (
        <div className="ct-empty">
          <p className="sh-muted">No orders yet.</p>
          <Link href="/shop" className="sh-btn">Go to the shop</Link>
        </div>
      ) : (
        <div className="or-row">
          {current ? <Track o={current} t={t} d={d} now={now} px={px} onCancel={() => act(current, "cancel")} /> : <div className="or-track or-none"><p className="sh-muted">Nothing {tab === "active" ? "on the way" : tab === "returns" ? "being returned" : "here"} right now.</p></div>}
          <aside className="or-side">
            {current && (
              <div className="or-box">
                <h2>In this order</h2>
                {current.items.map((it) => (
                  <div key={it.productId + it.variant} className="or-item">
                    <Link href={`/shop/${it.productId}`} className="or-img"><ProductArt id={it.productId} name={it.name} images={it.images} size={28} /></Link>
                    <div className="ct-t">
                      <strong>{it.qty > 1 ? `${it.qty} × ` : ""}{it.name}</strong>
                      <small>{[it.variant, it.film && it.startsAt ? `For ${it.film}, ${t(it.startsAt)}` : "", !it.beforeShow && current.items.some((x) => x.beforeShow) && ACTIVE.has(current.status) ? `ships separately, arrives ${new Date(Date.parse(current.placedAt ?? current.createdAt) + Math.max(1, it.shipDays) * 86_400_000).toLocaleDateString("en-GB", { weekday: "short", timeZone: tz })}` : ""].filter(Boolean).join(" · ")}</small>
                      {current.status === "delivered" && (reviewable.includes(it.productId) || current.deliveredAt) && (
                        <span className="or-rate" aria-label={`Rate ${it.name}`}>
                          {[1, 2, 3, 4, 5].map((n) => <button key={n} type="button" onClick={() => rate(it.productId, n)} aria-label={`${n} star${n > 1 ? "s" : ""}`}>★</button>)}
                        </span>
                      )}
                    </div>
                    <span className="or-p">{price(it.unitNgn * it.qty, px)}</span>
                  </div>
                ))}
                {current.plan ? (
                  <>
                    <p className="or-tot"><span>Paid so far · {current.plan.paid} of {current.plan.parts} parts</span><strong>{price(current.plan.paidNgn, px)}</strong></p>
                    <small className="sh-muted">
                      {current.plan.status === "done" ? `Fully paid: ${price(current.totalNgn, px)} over ${current.plan.parts} parts on your Paystack card.`
                        : current.plan.status === "failed" ? `We could not take part ${current.plan.paid + 1} after three tries${current.plan.lastError ? ` (${current.plan.lastError})` : ""}. Email help@e-cinema.net to pay the rest another way.`
                        : current.plan.status === "stopped" ? "The plan stopped with this order; no more parts will be charged."
                        : current.plan.nextDue ? `Next part ${price(current.plan.nextNgn, px)} on ${new Date(current.plan.nextDue).toLocaleDateString("en-GB", { day: "numeric", month: "long", timeZone: tz })}, charged to the same card. Order total ${price(current.totalNgn, px)}.`
                        : `Order total ${price(current.totalNgn, px)} in ${current.plan.parts} parts.`}
                    </small>
                  </>
                ) : (
                  <p className="or-tot"><span>{current.method === "cod" && current.status !== "delivered" ? "To pay on delivery" : "Total paid"}</span><strong>{price(current.totalNgn, px)}</strong></p>
                )}
                {current.method === "paypal" && <small className="sh-muted">Charged {(current.chargeCents / 100).toLocaleString("en", { style: "currency", currency: current.chargeCurrency })} through PayPal</small>}
              </div>
            )}
            {earlier.length > 0 && (
              <div className="or-box">
                <h2>Earlier orders</h2>
                {earlier.slice(0, 8).map((o) => {
                  const canReturn = o.status === "delivered" && o.deliveredAt && Date.parse(o.deliveredAt) > now - RETURN_DAYS * 86_400_000;
                  return (
                    <div key={o.id} className="or-o">
                      <button type="button" className="ct-t or-pick" onClick={() => { setTab(RETURNS.has(o.status) ? "returns" : "delivered"); setSel(o.id); }}>
                        <strong>{o.number} · {d(o.createdAt)}</strong>
                        <small>{o.items.map((i) => i.name).join(", ")}{o.status === "cancelled" ? " · cancelled" : RETURNS.has(o.status) ? ` · ${o.status === "returned" ? "returned" : "return in progress"}` : ""}</small>
                      </button>
                      <button type="button" className="sh-btn sec sm" onClick={() => act(o, "reorder")}>Reorder</button>
                      {canReturn && <button type="button" className="sh-btn ghost sm" onClick={() => act(o, "return")}>Return</button>}
                    </div>
                  );
                })}
              </div>
            )}
          </aside>
        </div>
      )}
    </>
  );
}

function Track({ o, t, d, now, px, onCancel }: { o: Order; t: (iso?: string) => string; d: (iso: string) => string; now: number; px: Pricing; onCancel: () => void }) {
  void px;
  const film = o.items.find((i) => i.film && i.startsAt);
  const eta = o.rider?.eta && !Number.isNaN(Date.parse(o.rider.eta)) ? o.rider.eta : undefined;
  const pill =
    o.status === "delivered" ? { text: "Delivered", cls: "ok" }
    : o.status === "cancelled" ? { text: "Cancelled", cls: "off" }
    : o.status === "returning" ? { text: "Return in progress", cls: "warn" }
    : o.status === "returned" ? { text: "Returned", cls: "off" }
    : film && Date.parse(film.startsAt!) > now ? { text: `Arriving before your ${t(film.startsAt)} premiere`, cls: "" }
    : eta ? { text: `Arrives ${t(eta)}`, cls: "" }
    : { text: o.status === "out" ? "On the way" : o.status === "packed" ? "Packed" : "Preparing", cls: "" };
  // Where the rider is along the route: from the hub to the door, by time against their ETA.
  const progress =
    o.status === "delivered" || o.status === "returned" ? 1
    : o.status === "out" && o.outAt && eta ? Math.min(0.95, Math.max(0.3, (now - Date.parse(o.outAt)) / Math.max(1, Date.parse(eta) - Date.parse(o.outAt))))
    : o.status === "out" ? 0.5 : o.status === "packed" ? 0.12 : 0.04;
  const paid = o.method === "cod" ? "pay on delivery" : o.method === "paystack" ? "paid with Paystack" : o.method === "flutterwave" ? "paid with Flutterwave" : o.method === "instalments" ? `paying in ${o.plan?.parts ?? 6} parts` : "paid with PayPal";
  const steps: { title: string; sub: string; at?: string; state: "done" | "now" | "todo" }[] =
    o.status === "returning" || o.status === "returned"
      ? [
          { title: "Delivered", sub: o.deliveredAt ? d(o.deliveredAt) : "", state: "done" },
          { title: "Return requested", sub: [o.returnAt ? t(o.returnAt) : "", o.returnReason].filter(Boolean).join(" · "), state: "done" },
          { title: "Back at the Lagos hub", sub: o.returnedAt ? `${t(o.returnedAt)} · refund on its way` : "A rider will collect it", state: o.status === "returned" ? "done" : "now" },
        ]
      : [
          { title: "Ordered", sub: `${t(o.placedAt ?? o.createdAt)} · ${paid}`, state: "done" },
          ...(o.status === "cancelled"
            ? [{ title: "Cancelled", sub: `${t(o.cancelledAt)}${o.method === "paypal" ? " · refunded to your PayPal" : o.method === "paystack" || o.method === "flutterwave" || o.method === "instalments" ? " · refunded to your card or bank" : ""}`, state: "done" as const }]
            : [
                { title: "Packed at Lagos hub", sub: o.packedAt ? t(o.packedAt) : "Being packed now", state: o.packedAt ? ("done" as const) : ("now" as const) },
                {
                  title: "Out for delivery",
                  sub: o.outAt ? [o.rider?.name ? `Rider ${o.rider.name}` : "", eta ? `arrives ${t(eta)}` : t(o.outAt)].filter(Boolean).join(" · ") : "A rider picks it up next",
                  state: o.deliveredAt ? ("done" as const) : o.outAt ? ("now" as const) : ("todo" as const),
                },
                { title: "Delivered", sub: o.deliveredAt ? t(o.deliveredAt) : "Leave at the door or hand to you", state: o.deliveredAt ? ("done" as const) : ("todo" as const) },
              ]),
        ];
  const where = [o.address.area, o.address.city].filter(Boolean).join(", ");
  const x = 60 + progress * 780, y = 150 - 280 * progress * (1 - progress);
  const phone = o.rider?.phone?.replace(/[^\d+]/g, "");
  return (
    <section className="or-track">
      <div className="or-th">
        <div className="ct-t">
          <h2>Order {o.number}</h2>
          <small>Placed {d(o.placedAt ?? o.createdAt)} · {where}</small>
        </div>
        <span className={`or-pill ${pill.cls}`}>{pill.text}</span>
      </div>
      <div className="or-map" role="img" aria-label={`Route from the Lagos hub to ${where}, ${Math.round(progress * 100)}% of the way`}>
        <svg viewBox="0 0 900 200" preserveAspectRatio="none" aria-hidden>
          <defs><pattern id="or-grid" width="40" height="40" patternUnits="userSpaceOnUse"><path d="M40 0H0v40" fill="none" stroke="#1b2430" strokeWidth="1" /></pattern></defs>
          <rect width="900" height="200" fill="url(#or-grid)" />
          <path d="M60 150 Q 450 10 840 150" fill="none" stroke="#2a3644" strokeWidth="6" strokeLinecap="round" />
          <path d="M60 150 Q 450 10 840 150" fill="none" stroke="#e3182d" strokeWidth="4" strokeLinecap="round" pathLength={1} strokeDasharray={`${progress} 1`} />
          <circle cx="60" cy="150" r="7" fill="#22c55e" />
          <circle cx="840" cy="150" r="8" fill="none" stroke="#f4f4f6" strokeWidth="3" />
        </svg>
        <span className="or-dot" style={{ left: `${(x / 900) * 100}%`, top: `${(y / 200) * 100}%` }} />
        <span className="or-lbl l">Lagos hub</span>
        <span className="or-lbl r">{o.address.area || o.address.city}</span>
        {o.status === "out" && <span className="or-cap">Position estimated from the rider&apos;s arrival time</span>}
      </div>
      <ol className="or-steps">
        {steps.map((s) => (
          <li key={s.title} className={s.state}>
            <span className="or-sdot" aria-hidden>{s.state === "done" ? <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg> : s.state === "now" ? <i /> : null}</span>
            <div className="ct-t"><strong>{s.title}</strong><small>{s.sub}</small></div>
          </li>
        ))}
      </ol>
      {o.rider?.name && ACTIVE.has(o.status) && (
        <div className="or-rider">
          <span className="or-av">{o.rider.name.slice(0, 2).toUpperCase()}</span>
          <div className="ct-t">
            <strong>{o.rider.name} · E-Cinema Delivery</strong>
            <small>{[o.rider.vehicle, o.rider.plate].filter(Boolean).join(" · ")}</small>
          </div>
          {phone && <a className="sh-btn sec sm" href={`tel:${phone}`}>Call</a>}
          {phone && <a className="sh-btn ghost sm" href={`https://wa.me/${phone.replace(/^\+/, "")}`} target="_blank" rel="noopener noreferrer">Chat</a>}
        </div>
      )}
      {o.status === "placed" && <button type="button" className="sh-btn ghost sm or-cancel" onClick={onCancel}>Cancel order</button>}
      {(o.status === "delivered" || o.status === "out") && <Link className="sh-btn ghost sm or-cancel" href={`/help/refund?order=${o.id}`}>Problem with this order?</Link>}
    </section>
  );
}
