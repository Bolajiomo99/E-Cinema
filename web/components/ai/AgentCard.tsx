"use client";

import { useEffect, useState } from "react";
import PayPalTicketButton from "@/components/PayPalTicketButton";
import type { Showtime } from "@/lib/catalog";
import { useTickets } from "./tickets";

// What the viewer's AI agent is doing for them right now: holds waiting for PayPal approval
// first, then their next paid seat, then the rules the agent works under.
export default function AgentCard({ films, limit }: { films: Pick<Showtime, "id" | "film" | "startsAt" | "price">[]; limit: number }) {
  const { tickets, refresh } = useTickets();
  const [now, setNow] = useState<number | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const first = setTimeout(tick, 0);
    const t = setInterval(tick, 15_000);
    return () => { clearTimeout(first); clearInterval(t); };
  }, []);
  const film = (id: string) => films.find((f) => f.id === id);
  const held = tickets.filter((t) => t.status === "held" && (now === null || Date.parse(t.expiresAt) > now));
  const next = tickets.find((t) => t.status === "paid");
  const time = (iso: string) => new Date(iso).toLocaleString([], { weekday: "short", hour: "2-digit", minute: "2-digit" });

  async function release(holdId: string) {
    setBusy(holdId);
    await fetch(`/api/me/holds/${holdId}`, { method: "DELETE" }).catch(() => {});
    setBusy(null);
    refresh();
  }

  return (
    <aside className="hm-agent">
      <p className="lp-eyebrow">YOUR AGENT</p>
      {held.map((t) => {
        const f = film(t.showtimeId);
        const mins = now === null ? null : Math.max(1, Math.round((Date.parse(t.expiresAt) - now) / 60_000));
        return (
          <div key={t.holdId} className="hm-wait">
            <span className="hm-wait-tag">Waiting for you{mins !== null && ` · held for ${mins} more min`}</span>
            <strong>Holding {t.seats} seat{t.seats > 1 ? "s" : ""} for {f?.film ?? t.showtimeId}{f && ` · ${time(f.startsAt)}`}{f && ` · $${(Number(f.price.value) * t.seats).toFixed(2)}`}</strong>
            <div className="hm-wait-actions">
              {t.orderId && <PayPalTicketButton orderId={t.orderId} />}
              <button type="button" className="lp-btn sm ghost" disabled={busy === t.holdId} onClick={() => release(t.holdId)}>Give seats back</button>
            </div>
          </div>
        );
      })}
      {held.length === 0 && next && (
        <div className="hm-wait ok">
          <span className="hm-wait-tag">Your next seat</span>
          <strong>{film(next.showtimeId)?.film ?? next.showtimeId} · {next.seats} seat{next.seats > 1 ? "s" : ""}{film(next.showtimeId) && ` · ${time(film(next.showtimeId)!.startsAt)}`}</strong>
          <div className="hm-wait-actions">
            <a className="lp-btn sm" href={`/room/${next.showtimeId}`}>Open the room</a>
            <a className="lp-btn sm ghost" href={`/api/calendar/${next.showtimeId}.ics`}>Add to calendar</a>
          </div>
        </div>
      )}
      {held.length === 0 && !next && (
        <div className="hm-wait idle">
          <span className="hm-wait-tag">Nothing waiting</span>
          <strong>Ask for a film and I&apos;ll hold the seats while you pay.</strong>
        </div>
      )}
      <ul className="hm-caps">
        <li>Spending limit ${limit} a booking, asks before going above it</li>
        <li>Holds seats for 10 minutes while you approve in PayPal</li>
        <li>Adds premieres to your calendar with a reminder</li>
        <li>Finds merch from the film through Channel3</li>
      </ul>
    </aside>
  );
}
