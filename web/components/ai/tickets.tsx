"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";

export type MyTicket = { holdId: string; showtimeId: string; seats: number; status: "held" | "paid"; orderId?: string; expiresAt: string };
type Ctx = { tickets: MyTicket[]; refresh: () => void };

const TicketsContext = createContext<Ctx>({ tickets: [], refresh: () => {} });

// One copy of the viewer's seats for the whole page, so the agent card, the calendar and the
// concierge agree. It refreshes after the agent acts and every 30 seconds while holds count down.
export function TicketsProvider({ initial, children }: { initial: MyTicket[]; children: React.ReactNode }) {
  const [tickets, setTickets] = useState(initial);
  const refresh = useCallback(() => {
    fetch("/api/me/tickets", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((list) => Array.isArray(list) && setTickets(list))
      .catch(() => {});
  }, []);
  useEffect(() => {
    const t = setInterval(refresh, 30_000);
    return () => clearInterval(t);
  }, [refresh]);
  return <TicketsContext.Provider value={{ tickets, refresh }}>{children}</TicketsContext.Provider>;
}

export const useTickets = () => useContext(TicketsContext);
