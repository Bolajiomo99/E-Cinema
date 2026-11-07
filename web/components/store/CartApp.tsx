"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import PayPalTicketButton from "@/components/PayPalTicketButton";
import ProductArt from "@/components/store/ProductArt";
import PayLogo, { type PayBrand } from "@/components/pay/PayLogo";
import { announce, setCart, store } from "@/lib/store-client";
import { firstPart, INSTALMENT_MIN_NGN, INSTALMENT_PARTS, price, type Address, type Order, type Pricing, type Quote } from "@/lib/store-types";

type Method = { id: string; name: string; sub: string; ready: boolean; logo: PayBrand };

// Cart and checkout (Figma 53:1111): change amounts, set the address, take the bundle offer,
// pick how to pay, and pay. Totals always come back from the server.
export default function CartApp({ initial, px, country, countryLabel, paypal, paystack = false, flutterwave = false, failed = "", tz }: {
  initial: Quote; px: Pricing; country?: string; countryLabel: string; paypal: boolean; paystack?: boolean; flutterwave?: boolean; failed?: string; tz: string;
}) {
  const [q, setQ] = useState(initial);
  const paypalOrder = useRef("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(failed);
  const [editing, setEditing] = useState(!initial.address && initial.lines.length > 0);
  const ng = (country ?? q.address?.country) === "NG";
  const methods: Method[] = [
    { id: "card", name: ng ? "Card · Verve, Visa, Mastercard" : "Card · Visa, Mastercard", sub: ng ? "Paystack secure form" : "Through PayPal, no account needed", ready: ng ? paystack : paypal, logo: ng ? "card-ng" : "card" },
    { id: "paypal", name: "PayPal", sub: "Pay with your PayPal balance or linked card", ready: paypal, logo: "paypal" },
    ...(ng ? [{ id: "bank", name: "Bank transfer or USSD", sub: "Flutterwave · instant", ready: flutterwave, logo: "flutterwave" as PayBrand }] : []),
    { id: "cod", name: "Pay on delivery", sub: "Cash or card at your door, Lagos only", ready: q.cod, logo: "cash" },
    { id: "crypto", name: "Crypto · BTC, USDC", sub: "Coinbase Commerce", ready: false, logo: "coinbase" },
    ...(ng ? [{
      id: "instalments", name: `Pay in ${INSTALMENT_PARTS} instalments`,
      sub: q.totalNgn >= INSTALMENT_MIN_NGN ? `${INSTALMENT_PARTS} × ${price(firstPart(q.totalNgn), px)} · first today, then monthly on the same card` : `For orders of ${price(INSTALMENT_MIN_NGN, px)} or more`,
      ready: paystack && q.totalNgn >= INSTALMENT_MIN_NGN, logo: "paystack" as PayBrand,
    }] : []),
  ];
  const [method, setMethod] = useState(() => methods.find((m) => m.ready && m.id === "paypal")?.id ?? methods.find((m) => m.ready)?.id ?? "");
  // A method can open up later (pay on delivery once a Lagos address is saved).
  const fallback = methods.find((m) => m.ready && m.id === "paypal")?.id ?? methods.find((m) => m.ready)?.id ?? "";
  const chosen = methods.find((m) => m.id === method && m.ready) ?? methods.find((m) => m.id === fallback);
  const local = ng && chosen?.id === "card" ? "paystack" : ng && chosen?.id === "bank" ? "flutterwave" : chosen?.id === "instalments" ? "instalments" : "";
  const usesPayPal = !local && (chosen?.id === "paypal" || chosen?.id === "card");

  const change = async (productId: string, variant: string, qty: number, add = false) => {
    setBusy(true);
    setErr("");
    const r = await setCart(productId, variant, qty, add);
    setBusy(false);
    if (r.ok) setQ(r.data);
    else setErr(r.data.error ?? "Could not update your cart");
  };

  const placeCOD = async () => {
    setBusy(true);
    setErr("");
    const r = await store<Order>("checkout", "POST", { method: "cod", expectTotalNgn: q.totalNgn });
    if (r.ok) return window.location.assign(`/shop/orders?o=${r.data.id}&placed=1`);
    setBusy(false);
    setErr(r.data.error ?? "Could not place the order");
    if (r.status === 409) refresh();
  };
  // Paystack (cards in Nigeria) and Flutterwave (bank transfer, USSD): the order is made on the
  // server, then the buyer pays on the provider's page and comes back to tracking.
  const payLocal = async () => {
    setBusy(true);
    setErr("");
    const r = await store<{ url: string; order: Order }>("checkout", "POST", { method: local, expectTotalNgn: q.totalNgn });
    if (r.ok && r.data.url) return window.location.assign(r.data.url);
    setBusy(false);
    setErr((!r.ok && r.data.error) || "Could not start the payment");
    if (r.status === 409) refresh();
  };
  const refresh = async () => {
    const r = await store<Quote>("cart");
    if (r.ok) {
      setQ(r.data);
      announce(r.data);
    }
  };
  // PayPal: the order is made on the server from the cart; onPaid goes to tracking.
  const createPayPal = async () => {
    const r = await store<{ orderId: string; order: Order }>("checkout", "POST", { method: "paypal", expectTotalNgn: q.totalNgn });
    if (!r.ok) {
      setErr(r.data.error ?? "Could not start PayPal");
      if (r.status === 409) refresh();
      throw new Error(r.data.error ?? "checkout failed");
    }
    paypalOrder.current = r.data.order.id;
    return r.data.orderId;
  };

  if (q.lines.length === 0) {
    return (
      <div className="ct-empty">
        <h1 className="ct-h1">Your cart is empty</h1>
        <p className="sh-muted">Snacks for tonight, a VR headset for the front row, or a hoodie for the cinema air-con.</p>
        <Link href="/shop" className="sh-btn">Go to the shop</Link>
        <Link href="/shop/orders" className="sh-link">See your orders</Link>
      </div>
    );
  }

  const snacks = q.lines.filter((l) => l.product.beforeShow);
  const others = q.lines.filter((l) => !l.product.beforeShow && l.product.ships !== "digital");
  const when = (iso: string) => new Date(iso).toLocaleString("en-GB", { weekday: "short", hour: "2-digit", minute: "2-digit", timeZone: tz });
  const slow = Math.max(0, ...others.map((l) => l.product.shipDays));
  const plan = q.plan === "student" ? "Student" : q.plan === "vip" ? "VIP" : q.plan === "enterprise" ? "Enterprise" : "Pro";

  return (
    <div className="ct-row">
      <section className="ct-l">
        <h1 className="ct-h1">Your cart · {q.count} item{q.count === 1 ? "" : "s"}</h1>
        {q.lines.map((l) => (
          <div key={l.product.id + l.variant} className="ct-item">
            <Link href={`/shop/${l.product.id}`} className="ct-img"><ProductArt id={l.product.id} name={l.product.name} images={l.product.images} size={44} /></Link>
            <div className="ct-t">
              <Link href={`/shop/${l.product.id}`}>{l.product.name}</Link>
              <small>{[l.variant, l.product.beforeShow ? (q.nextShow ? `deliver ${when(new Date(Date.parse(q.nextShow.startsAt) - 3_600_000).toISOString())}` : "same day") : ""].filter(Boolean).join(" · ") || l.product.sub}</small>
            </div>
            <div className="ct-q" role="group" aria-label={`How many ${l.product.name}`}>
              <button type="button" onClick={() => change(l.product.id, l.variant, l.qty - 1)} disabled={busy} aria-label={l.qty === 1 ? "Remove" : "One less"}>
                {l.qty === 1 ? <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14" /></svg> : <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden><path d="M5 12h14" /></svg>}
              </button>
              <span aria-live="polite">{l.qty}</span>
              <button type="button" onClick={() => change(l.product.id, l.variant, l.qty + 1)} disabled={busy || l.qty >= 20} aria-label="One more">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden><path d="M12 5v14M5 12h14" /></svg>
              </button>
            </div>
            <p className="ct-price">{price(l.lineNgn, px)}</p>
          </div>
        ))}

        {editing ? (
          <AddressForm initial={q.address} country={country} onSaved={(nq) => { setQ(nq); setEditing(false); }} onCancel={q.address ? () => setEditing(false) : undefined} />
        ) : (
          <div className="ct-del">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M21 10c0 7-9 13-9 13S3 17 3 10a9 9 0 0 1 18 0z" /><circle cx="12" cy="10" r="3" /></svg>
            <div className="ct-t">
              <strong>Deliver to {[q.address?.line1, q.address?.area, q.address?.city].filter(Boolean).join(", ")}</strong>
              <small>
                {[
                  snacks.length ? (q.nextShow ? `Snacks arrive before your ${q.nextShow.film} premiere` : "Snacks arrive the same day") : "",
                  others.length ? `${others.length === 1 ? others[0].product.name.replace(/^E-Cinema /, "") : "the rest"} in ${slow} day${slow === 1 ? "" : "s"}` : "",
                ].filter(Boolean).join(" · ")}
              </small>
            </div>
            <button type="button" className="sh-btn ghost sm" onClick={() => setEditing(true)}>Change</button>
          </div>
        )}

        {q.problems.length > 0 && (
          <div className="ct-warn" role="alert">
            {q.problems.map((p) => <p key={p}>{p}. Remove it or change the address.</p>)}
          </div>
        )}

        {q.suggestion && (
          <div className="ct-ai">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden><path d="M12 2l2.4 6.6L21 11l-6.6 2.4L12 20l-2.4-6.6L3 11l6.6-2.4z" /></svg>
            <p>Add the {q.suggestion.name} and save {price(q.suggestion.saveNgn, px)} on the VR bundle.</p>
            <button type="button" className="sh-btn sec sm" disabled={busy} onClick={() => change(q.suggestion!.productId, "", 1, true).then(() => undefined)}>Add</button>
          </div>
        )}
      </section>

      <aside className="ct-r">
        <h2>Pay</h2>
        <div role="radiogroup" aria-label="How to pay" className="ct-pms">
          {methods.map((m) => (
            <button key={m.id} type="button" role="radio" aria-checked={chosen?.id === m.id} disabled={!m.ready}
              className={`ct-pm${chosen?.id === m.id ? " on" : ""}`} onClick={() => setMethod(m.id)}>
              <span className="ct-radio" aria-hidden />
              <PayLogo brand={m.logo} />
              <span className="ct-t"><strong>{m.name}</strong><small>{m.sub}</small></span>
              {!m.ready && <span className="soon-tag">{m.id === "cod" ? "Lagos only" : m.id === "instalments" && paystack ? `${price(INSTALMENT_MIN_NGN, px)}+` : "soon"}</span>}
            </button>
          ))}
        </div>
        <div className="ct-sum">
          <p><span>Items</span><span>{price(q.itemsNgn, px)}</span></p>
          {q.discountNgn > 0 && <p><span>{plan} member discount 5%</span><span className="ok">−{price(q.discountNgn, px)}</span></p>}
          {q.bundleNgn > 0 && <p><span>VR bundle</span><span className="ok">−{price(q.bundleNgn, px)}</span></p>}
          <p><span>Delivery</span><span>{q.deliveryNgn ? price(q.deliveryNgn, px) : "Free"}</span></p>
          {q.vatNgn > 0 && <p><span>VAT {Math.round(q.vatRate * 1000) / 10}%</span><span>{price(q.vatNgn, px)}</span></p>}
          <hr />
          <p className="tot"><span>Total</span><strong>{price(q.totalNgn, px)}</strong></p>
        </div>
        {err && <p className="ct-err" role="alert">{err}</p>}
        {!q.address || q.problems.length ? (
          <button type="button" className="sh-btn wide" onClick={() => setEditing(true)} disabled={busy}>{q.address ? "Fix the items above to pay" : "Add your address to pay"}</button>
        ) : chosen?.id === "cod" ? (
          <button type="button" className="sh-btn wide" onClick={placeCOD} disabled={busy}>{busy ? "Placing…" : `Place order · pay ${price(q.totalNgn, px)} on delivery`}</button>
        ) : local ? (
          <button type="button" className="sh-btn wide" onClick={payLocal} disabled={busy}>{busy ? "Opening the secure page…" : local === "instalments" ? `Pay ${price(firstPart(q.totalNgn), px)} today with Paystack` : `Pay ${price(q.totalNgn, px)} with ${local === "paystack" ? "Paystack" : "Flutterwave"}`}</button>
        ) : usesPayPal ? (
          <PayPalTicketButton key={chosen?.id} card={chosen?.id === "card"} className="sh-btn wide" label={`Pay ${price(q.totalNgn, px)}`} create={createPayPal} onPaid={() => window.location.assign(`/shop/orders?o=${paypalOrder.current}&placed=1`)} disabled={busy} />
        ) : (
          <button type="button" className="sh-btn wide" disabled>Choose a way to pay</button>
        )}
        <p className="ct-foot">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden><circle cx="12" cy="12" r="10" /><path d="M2 12h20M12 2a15 15 0 0 1 0 20M12 2a15 15 0 0 0 0 20" /></svg>
          Prices and methods follow your country ({countryLabel}){usesPayPal && px.currency === "NGN" ? " · PayPal charges the same amount in US dollars" : ""}
        </p>
      </aside>
    </div>
  );
}

function AddressForm({ initial, country, onSaved, onCancel }: { initial: Address | null; country?: string; onSaved: (q: Quote) => void; onCancel?: () => void }) {
  const [a, setA] = useState<Address>(initial ?? { name: "", phone: "", line1: "", area: "", city: country === "NG" ? "Lagos" : "", state: country === "NG" ? "Lagos" : "", country: country ?? "NG" });
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const f = (k: keyof Address, label: string, opts: { auto?: string; type?: string; half?: boolean } = {}) => (
    <label className={opts.half ? "half" : undefined}>
      <span>{label}</span>
      <input value={a[k]} type={opts.type ?? "text"} autoComplete={opts.auto} onChange={(e) => setA({ ...a, [k]: e.target.value })} required={k !== "area" && k !== "state"} />
    </label>
  );
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr("");
    const r = await store<Quote>("address", "PUT", a);
    setBusy(false);
    if (r.ok) onSaved(r.data);
    else setErr(r.data.error ?? "Could not save the address");
  };
  return (
    <form className="ct-addr" onSubmit={save}>
      <h2>Delivery address</h2>
      {f("name", "Full name", { auto: "name", half: true })}
      {f("phone", "Phone for the rider", { auto: "tel", type: "tel", half: true })}
      {f("line1", "Street address", { auto: "address-line1" })}
      {f("area", "Area (e.g. Lekki)", { auto: "address-level3", half: true })}
      {f("city", "City", { auto: "address-level2", half: true })}
      {f("state", "State", { auto: "address-level1", half: true })}
      <label className="half"><span>Country code</span><input value={a.country} maxLength={2} autoComplete="country" onChange={(e) => setA({ ...a, country: e.target.value.toUpperCase() })} required /></label>
      {err && <p className="ct-err" role="alert">{err}</p>}
      <div className="ct-addr-b">
        <button className="sh-btn sm" disabled={busy}>{busy ? "Saving…" : "Save address"}</button>
        {onCancel && <button type="button" className="sh-btn ghost sm" onClick={onCancel}>Cancel</button>}
      </div>
    </form>
  );
}
