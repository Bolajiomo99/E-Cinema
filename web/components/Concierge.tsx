"use client";

import { useState } from "react";
import type Anthropic from "@anthropic-ai/sdk";
import PayPalTicketButton from "./PayPalTicketButton";
import type { PendingOrder } from "@/lib/concierge";
import type { ShopItem } from "@/lib/shop";

type Turn = { role: "viewer" | "concierge"; text: string; orders?: PendingOrder[]; shop?: ShopItem[] };

function textOf(content: Anthropic.Beta.BetaMessageParam["content"]): string {
  if (!content) return "";
  if (typeof content === "string") return content;
  return content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("\n").trim();
}

export default function Concierge() {
  const [history, setHistory] = useState<Anthropic.Beta.BetaMessageParam[]>([]);
  const [turns, setTurns] = useState<Turn[]>([
    { role: "concierge", text: "Hi, I'm your E-Cinema concierge. Tell me what you feel like watching and how many seats you need." },
  ]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    const text = draft.trim();
    if (!text || busy) return;
    setDraft("");
    setBusy(true);
    setTurns((t) => [...t, { role: "viewer", text }]);
    const messages = [...history, { role: "user" as const, content: text }];
    try {
      const res = await fetch("/api/concierge", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ messages }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      const added = (data.messages as Anthropic.Beta.BetaMessageParam[]).slice(messages.length);
      const reply = added.filter((m) => m.role === "assistant").map((m) => textOf(m.content)).filter(Boolean).at(-1);
      setHistory(data.messages);
      setTurns((t) => [...t, { role: "concierge", text: data.refused ? "Sorry, I can't help with that one." : reply || "Done.", orders: data.orders, shop: data.shop }]);
    } catch {
      setTurns((t) => [...t, { role: "concierge", text: "I couldn't reach the booking desk. Please try again." }]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="concierge">
      <h1>Concierge</h1>
      <p className="sub">Booking help from Claude. You approve every payment in PayPal.</p>
      <ol className="chat">
        {turns.map((t, i) => (
          <li key={i} className={t.role === "viewer" ? "viewer" : "agent"}>
            <p>{t.text}</p>
            {t.orders?.map((o) => (
              <div key={o.orderId} className="order-card">
                <span>{o.film} · {o.seats} seat{o.seats > 1 ? "s" : ""} · {o.currency} {o.total}</span>
                <PayPalTicketButton orderId={o.orderId} />
              </div>
            ))}
            {t.shop && t.shop.length > 0 && (
              <div className="shop-row">
                {t.shop.map((p) => (
                  <a key={p.id} className="shop-card" href={p.url} target="_blank" rel="noopener noreferrer sponsored">
                    {/* Retailer images come from many domains, so next/image is not used. */}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    {p.image && <img src={p.image} alt="" loading="lazy" />}
                    <span className="shop-title">{p.title}</span>
                    <span className="shop-meta">{p.currency} {p.price.toFixed(2)} · {p.store}</span>
                  </a>
                ))}
              </div>
            )}
          </li>
        ))}
        {busy && <li className="agent"><p className="typing">Thinking…</p></li>}
      </ol>
      <form onSubmit={send} className="composer">
        <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Two seats for something Nollywood on Monday" maxLength={500} aria-label="Message the concierge" />
        <button disabled={busy || !draft.trim()}>Send</button>
      </form>
    </section>
  );
}
