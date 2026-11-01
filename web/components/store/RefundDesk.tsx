"use client";

import { useState } from "react";
import { store } from "@/lib/store-client";

export type DeskRefund = { id: string; orderId: string; number: string; reason: string; note: string; outcome: string; status: string; amountNgn: number; createdAt: string; buyer: string };
const REASON: Record<string, string> = { late: "Arrived late", wrong: "Wrong item", damaged: "Damaged", never: "Never arrived" };

// Refund requests the rules could not approve on their own, and approved replacements still to send.
export default function RefundDesk({ review, send }: { review: DeskRefund[]; send: DeskRefund[] }) {
  const [rv, setRv] = useState(review);
  const [sd, setSd] = useState(send);
  const [msg, setMsg] = useState("");
  const act = async (f: DeskRefund, action: "approve" | "decline" | "sent") => {
    const r = await store<{ refunded?: boolean; refund?: DeskRefund }>(`refunds/${f.id}`, "POST", { action });
    if (!r.ok) return setMsg(r.data.error ?? "Could not update");
    setMsg(action === "sent" ? `Replacement for ${f.number} sent` : `${f.number} ${action === "approve" ? "approved" : "declined"}${r.data.refunded ? " and refunded on PayPal" : ""}`);
    setRv((l) => l.filter((x) => x.id !== f.id));
    if (action === "sent") setSd((l) => l.filter((x) => x.id !== f.id));
    else if (action === "approve" && f.outcome === "replace") setSd((l) => [...l, { ...f, status: "approved" }]);
  };
  const row = (f: DeskRefund, buttons: React.ReactNode) => (
    <div key={f.id} className="or-o">
      <div className="ct-t">
        <strong>{f.number} · {REASON[f.reason] ?? f.reason} · {f.outcome === "replace" ? "wants a replacement" : `refund ₦${f.amountNgn.toLocaleString("en-NG")}`}</strong>
        <small>{[f.buyer, f.note].filter(Boolean).join(" · ")}</small>
      </div>
      {buttons}
    </div>
  );
  return (
    <section className="or-box" aria-label="Refund requests">
      <h2>Refund requests</h2>
      {msg && <p className="or-msg" role="status">{msg}</p>}
      {rv.length === 0 && <p className="sh-muted">Nothing waiting for a decision.</p>}
      {rv.map((f) => row(f, <>
        <button type="button" className="sh-btn sm" onClick={() => act(f, "approve")}>Approve</button>
        <button type="button" className="sh-btn ghost sm" onClick={() => act(f, "decline")}>Decline</button>
      </>))}
      {sd.length > 0 && <h2>Replacements to send</h2>}
      {sd.map((f) => row(f, <button type="button" className="sh-btn sec sm" onClick={() => act(f, "sent")}>Mark sent</button>))}
    </section>
  );
}
