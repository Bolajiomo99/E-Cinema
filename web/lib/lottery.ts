import "server-only";
import { accountApi } from "@/lib/auth";
import { findShowtime } from "@/lib/catalog";
import { emailEnabled, sendLotteryWin, sendSeatBack } from "@/lib/email";

// Sold-out lottery (Figma 31:1121) as the Go API reports it.
export type Lottery = {
  showtimeId: string; soldOut: boolean; soldOutAfterMin: number; sold: number; freeSeats: number; entries: number;
  myEntry?: number; drawAt: string; drawn: boolean; won: boolean; winHoldId?: string; winExpiresAt?: string;
  seedHash: string; seed?: string; waitlisted: boolean; hasTicket: boolean;
};
type Person = { email: string; name: string };

export async function lottery(id: string, session?: string): Promise<Lottery | null> {
  const r = await accountApi("GET", `/v1/lottery/${encodeURIComponent(id)}`, undefined, session).catch(() => null);
  return r?.status === 200 ? (r.body as Lottery) : null;
}

// Runs the draw if it is due and tells waitlisted viewers about returned seats. Safe to repeat:
// the API hands each winner and each waitlisted viewer back exactly once.
export async function sweep(id: string) {
  const r = await accountApi("POST", `/v1/lottery/${encodeURIComponent(id)}/sweep`, {}).catch(() => null);
  if (r?.status !== 200) return;
  const { winners, waitlist } = r.body as { winners: Person[]; waitlist: Person[] };
  const film = findShowtime(id)?.film ?? "your premiere";
  if (!emailEnabled) {
    if (process.env.E2E_LOG_CODES) for (const w of winners) console.log(`[e2e] lottery winner ${w.email}`);
    return;
  }
  await Promise.allSettled([
    ...winners.map((w) => sendLotteryWin(w.email, w.name, film, id)),
    ...waitlist.map((w) => sendSeatBack(w.email, w.name, film, id)),
  ]);
}
