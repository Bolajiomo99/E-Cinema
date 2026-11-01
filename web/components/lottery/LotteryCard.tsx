"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import HoldTimer from "@/components/checkout/HoldTimer";

type L = { myEntry?: number; drawn: boolean; won: boolean; winHoldId?: string; winExpiresAt?: string; seedHash: string; seed?: string; waitlisted: boolean; hasTicket: boolean; drawAt: string };

// The entry card and buttons from Figma 31:1121.
export default function LotteryCard({ l, showtimeId, signedIn }: { l: L; showtimeId: string; signedIn: boolean }) {
  const router = useRouter();
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const act = async (action: string, body: unknown = {}) => {
    setBusy(true);
    setMsg("");
    const r = await fetch(`/api/lottery/${showtimeId}/${action}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    setBusy(false);
    if (r.status === 401) return router.push(`/signin?next=/sold-out/${showtimeId}`);
    if (!r.ok) return setMsg(((await r.json().catch(() => ({}))) as { error?: string }).error ?? "Something went wrong");
    router.refresh();
  };
  const open = !l.drawn && Date.parse(l.drawAt) > Date.now();
  const winClaimed = l.won && l.hasTicket;

  return (
    <>
      <section className="so-entry" aria-live="polite">
        {l.hasTicket && !l.won ? (
          <>
            <div className="so-r"><h2>You have a seat</h2></div>
            <p>You bought a seat before it sold out, so you do not need the draw.</p>
          </>
        ) : l.won ? (
          <>
            <div className="so-r"><h2>{winClaimed ? "Your free seat is booked" : "You won a free seat"}</h2>{!winClaimed && l.winExpiresAt && <HoldTimer until={l.winExpiresAt} />}</div>
            <p>{winClaimed ? "It is in My tickets. You paid nothing." : "Your seat is held for 30 minutes and you pay nothing. Claim it before the timer runs out."}</p>
          </>
        ) : l.drawn ? (
          <>
            <div className="so-r"><h2>The draw is done</h2>{l.myEntry ? <span className="so-tag">ENTRY #{l.myEntry.toLocaleString("en-US")}</span> : null}</div>
            <p>{l.myEntry ? "Your entry was not picked this time. Join the waitlist and we email you the moment a paid seat comes back." : "The free seats have been given out. Join the waitlist for a paid seat that comes back."}</p>
          </>
        ) : l.myEntry ? (
          <>
            <div className="so-r"><h2>You are in the draw</h2><span className="so-tag">ENTRY #{l.myEntry.toLocaleString("en-US")}</span></div>
            <p>Winners are picked at random by an audited draw. If you win, your seat is held for 30 minutes and you pay nothing.</p>
          </>
        ) : (
          <>
            <div className="so-r"><h2>Enter the free-seat draw</h2></div>
            <p>Winners are picked at random by an audited draw. If you win, your seat is held for 30 minutes and you pay nothing.</p>
          </>
        )}
        <div className="so-boost">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#f5b841" strokeWidth="1.8" strokeLinecap="round" aria-hidden><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20a6.5 6.5 0 0 1 13 0M17 11l1.8 1.8L22 9.5" /></svg>
          <p>One verified account, one entry. Duplicate accounts are removed before the draw.</p>
        </div>
        <p className="so-audit">
          {l.seed
            ? <>Audit: the draw used seed <code>{l.seed.slice(0, 16)}…</code>, whose SHA-256 <code>{l.seedHash.slice(0, 16)}…</code> was shown here before the draw. Winners are the entries with the lowest HMAC-SHA256(seed, entry number).</>
            : <>Audit: the draw seed is locked in now. Its SHA-256 is <code>{l.seedHash.slice(0, 16)}…</code>; the seed itself is published here after the draw so anyone can check the winners.</>}
        </p>
        {msg && <p className="so-err" role="alert">{msg}</p>}
      </section>
      <div className="so-ctas">
        {l.won && !winClaimed ? (
          <button className="so-btn" disabled={busy} onClick={() => act("claim", { holdId: l.winHoldId })}>Claim my free seat</button>
        ) : winClaimed || l.hasTicket ? (
          <Link className="so-btn" href="/tickets">See my tickets</Link>
        ) : open && !l.myEntry ? (
          signedIn ? <button className="so-btn" disabled={busy} onClick={() => act("enter")}>Enter the draw</button>
            : <Link className="so-btn" href={`/signin?next=/sold-out/${showtimeId}`}>Sign in to enter the draw</Link>
        ) : (
          <button className="so-btn" disabled title="WhatsApp alerts switch on when our WhatsApp sender is approved">Notify me on WhatsApp <span className="soon-tag">Soon</span></button>
        )}
        {!l.hasTicket && (
          signedIn
            ? <button className="so-btn sec" disabled={busy} onClick={() => act("waitlist", { on: !l.waitlisted })}>{l.waitlisted ? "On the waitlist · leave" : "Join the waitlist for a paid seat"}</button>
            : <Link className="so-btn sec" href={`/signin?next=/sold-out/${showtimeId}`}>Join the waitlist for a paid seat</Link>
        )}
      </div>
    </>
  );
}
