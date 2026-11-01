"use client";

import { useState } from "react";
import { store } from "@/lib/store-client";
import type { Order } from "@/lib/store-types";

const NEXT: Record<string, { status: string; label: string }[]> = {
  placed: [{ status: "packed", label: "Mark packed" }, { status: "cancelled", label: "Cancel" }],
  packed: [{ status: "out", label: "Send out with rider" }, { status: "cancelled", label: "Cancel" }],
  out: [{ status: "delivered", label: "Mark delivered" }],
  returning: [{ status: "returned", label: "Return received" }],
};

// The delivery team's desk: every open order, oldest first, moved along one step at a time.
// Each change reaches the buyer's Orders page live.
export default function OrderDesk({ initial }: { initial: Order[] }) {
  const [orders, setOrders] = useState(initial);
  const [rider, setRider] = useState<Record<string, { name: string; phone: string; vehicle: string; plate: string; mins: string }>>({});
  const [msg, setMsg] = useState("");
  const go = async (o: Order, status: string) => {
    if (status === "cancelled" && !window.confirm(`Cancel ${o.number}? A PayPal payment is refunded.`)) return;
    const r0 = rider[o.id];
    const body: Record<string, unknown> = { status };
    if (status === "out") {
      if (!r0?.name || !r0?.phone) return setMsg("Add the rider's name and phone first");
      body.rider = { name: r0.name, phone: r0.phone, vehicle: r0.vehicle, plate: r0.plate, eta: new Date(Date.now() + (Number(r0.mins) || 45) * 60_000).toISOString() };
    }
    const r = await store<{ order: Order; refunded: boolean }>(`ops/${o.number}/status`, "POST", body);
    if (!r.ok) return setMsg(r.data.error ?? "Could not update");
    setMsg(`${o.number} is now ${r.data.order.status}${r.data.refunded ? " and refunded" : ""}`);
    setOrders((l) => (["delivered", "cancelled", "returned"].includes(r.data.order.status) ? l.filter((x) => x.id !== o.id) : l.map((x) => (x.id === o.id ? r.data.order : x))));
  };
  const field = (id: string, k: "name" | "phone" | "vehicle" | "plate" | "mins", ph: string) => (
    <input placeholder={ph} value={rider[id]?.[k] ?? ""} onChange={(e) => setRider((m) => ({ ...m, [id]: { ...(m[id] ?? { name: "", phone: "", vehicle: "", plate: "", mins: "" }), [k]: e.target.value } }))} />
  );
  return (
    <>
      {msg && <p className="or-msg" role="status">{msg}</p>}
      {orders.length === 0 && <p className="sh-muted">No open orders.</p>}
      <div className="desk">
        {orders.map((o) => (
          <article key={o.id} className="or-box">
            <h2>{o.number} · {o.status}</h2>
            <small className="sh-muted">{new Date(o.placedAt ?? o.createdAt).toLocaleString("en-GB", { timeZone: "Africa/Lagos" })} · {o.method === "cod" ? `collect ₦${o.totalNgn.toLocaleString("en-NG")}` : "paid"} · {o.buyer}</small>
            <p>{o.address.name}, {o.address.phone}<br />{[o.address.line1, o.address.area, o.address.city, o.address.state, o.address.country].filter(Boolean).join(", ")}</p>
            <ul>{o.items.map((i) => <li key={i.productId + i.variant}>{i.qty} × {i.name}{i.variant ? ` (${i.variant})` : ""}{i.film ? ` · before ${i.film} ${new Date(i.startsAt!).toLocaleString("en-GB", { timeZone: "Africa/Lagos", weekday: "short", hour: "2-digit", minute: "2-digit" })}` : ""}</li>)}</ul>
            {o.returnReason && <p>Return reason: {o.returnReason}</p>}
            {o.status === "packed" && <div className="desk-rider">{field(o.id, "name", "Rider name")}{field(o.id, "phone", "Rider phone")}{field(o.id, "vehicle", "Vehicle")}{field(o.id, "plate", "Plate")}{field(o.id, "mins", "Minutes away")}</div>}
            <div className="desk-b">{(NEXT[o.status] ?? []).map((n) => <button key={n.status} type="button" className={`sh-btn sm${n.status === "cancelled" ? " ghost" : ""}`} onClick={() => go(o, n.status)}>{n.label}</button>)}</div>
          </article>
        ))}
      </div>
    </>
  );
}
