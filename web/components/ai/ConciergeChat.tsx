"use client";

import ChatText from "./ChatText";
import { useEffect, useRef, useState } from "react";
import type Anthropic from "@anthropic-ai/sdk";
import PayPalTicketButton from "@/components/PayPalTicketButton";
import type { CalendarLink, PendingOrder } from "@/lib/concierge";
import type { ShopItem } from "@/lib/shop";
import { useTickets } from "./tickets";

type Turn = { role: "viewer" | "agent"; text: string; orders?: PendingOrder[]; shop?: ShopItem[]; calendar?: CalendarLink[] };

export const SUGGESTIONS = [
  "Something funny tonight for 2",
  "Remind me when Orbit Zero starts",
  "Best seats for The Last Harmattan",
  "What's on in Hindi this week?",
  "Shop the look from Tide of Lagos",
];

function textOf(content: Anthropic.Beta.BetaMessageParam["content"]): string {
  if (!content) return "";
  if (typeof content === "string") return content;
  return content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("\n").trim();
}

const when = (iso: string) => new Date(iso).toLocaleString([], { weekday: "short", hour: "2-digit", minute: "2-digit" });

// The E-Cinema AI conversation. Used inline on Home and inside the Ask AI drawer on every page.
export default function ConciergeChat({ compact = false, autoFocus = false, seed }: { compact?: boolean; autoFocus?: boolean; seed?: string }) {
  const { refresh } = useTickets();
  const [history, setHistory] = useState<Anthropic.Beta.BetaMessageParam[]>([]);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLOListElement>(null);
  const seeded = useRef(false);

  useEffect(() => {
    if (autoFocus) input.current?.focus();
  }, [autoFocus]);
  useEffect(() => {
    list.current?.lastElementChild?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [turns, busy]);

  async function ask(text: string) {
    text = text.trim();
    if (!text || busy) return;
    setDraft("");
    setBusy(true);
    setTurns((t) => [...t, { role: "viewer", text }]);
    const messages = [...history, { role: "user" as const, content: text }];
    try {
      const res = await fetch("/api/concierge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages, tz: Intl.DateTimeFormat().resolvedOptions().timeZone }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      const added = (data.messages as Anthropic.Beta.BetaMessageParam[]).slice(messages.length);
      const reply = added.filter((m) => m.role === "assistant").map((m) => textOf(m.content)).filter(Boolean).at(-1);
      setHistory(data.messages);
      setTurns((t) => [...t, { role: "agent", text: data.refused ? "Sorry, I can't help with that one." : reply || "Done.", orders: data.orders, shop: data.shop, calendar: data.calendar }]);
      if (data.ticketsChanged) refresh();
    } catch {
      setTurns((t) => [...t, { role: "agent", text: "I couldn't reach the booking desk. Please try again." }]);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (seed && !seeded.current) {
      seeded.current = true;
      const t = setTimeout(() => ask(seed), 0);
      return () => clearTimeout(t);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seed]);

  return (
    <div className={`ai-chat${compact ? " compact" : ""}`}>
      {turns.length > 0 && (
        <ol className="ai-turns" ref={list} aria-live="polite">
          {turns.map((t, i) => (
            <li key={i} className={t.role}>
              {t.role === "agent" ? <ChatText text={t.text} /> : <p>{t.text}</p>}
              {t.orders?.map((o) => (
                <div key={o.orderId} className="ai-order">
                  <div>
                    <span className="ai-tag">SEATS HELD FOR 10 MIN</span>
                    <strong>{o.film}</strong>
                    <span>{o.seats} seat{o.seats > 1 ? "s" : ""} · {o.currency === "USD" ? "$" : `${o.currency} `}{o.total}</span>
                  </div>
                  <PayPalTicketButton orderId={o.orderId} />
                </div>
              ))}
              {t.calendar?.map((c) => (
                <a key={c.showtimeId} className="ai-cal" href={`/api/calendar/${c.showtimeId}.ics`}>
                  <span aria-hidden>📅</span> Add {c.film} · {when(c.startsAt)} to my calendar
                </a>
              ))}
              {t.shop && t.shop.length > 0 && (
                <div className="ai-shop">
                  {t.shop.map((p) => (
                    <a key={p.id} href={p.url} target="_blank" rel="noopener noreferrer sponsored">
                      {/* Retailer images come from many domains, so next/image is not used. */}
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      {p.image && <img src={p.image} alt="" loading="lazy" />}
                      <span>{p.title}</span>
                      <em>{p.currency} {p.price.toFixed(2)} · {p.store}</em>
                    </a>
                  ))}
                </div>
              )}
            </li>
          ))}
          {busy && <li className="agent"><p className="ai-typing"><i /><i /><i /></p></li>}
        </ol>
      )}
      <form className="ai-prompt" onSubmit={(e) => { e.preventDefault(); ask(draft); }}>
        <input
          ref={input}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Find a Nollywood thriller tonight for 3 of us, under $20 in total"
          maxLength={500}
          aria-label="Ask E-Cinema AI"
        />
        <button className="lp-btn" disabled={busy || !draft.trim()}>{busy ? "…" : "Ask"}</button>
      </form>
      {turns.length === 0 && (
        <div className="ai-suggest" role="group" aria-label="Suggestions">
          {SUGGESTIONS.map((s) => <button key={s} type="button" className="lp-chip" onClick={() => ask(s)}>{s}</button>)}
        </div>
      )}
    </div>
  );
}
