"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

// Built from the Figma frame "Web / Film detail · Started, late entry open" (118:1379): how long
// the normal price lasts, when it doubles, when the doors close and when the film ends.
const mmss = (s: number) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
const hm = (t: number) => new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });

export function MinutesIn({ start }: { start: number }) {
  const now = useNow(15_000);
  return <>{now === null ? "" : ` · ${Math.max(0, Math.floor((now - start) / 60_000))} MIN IN`}</>;
}

function useNow(every: number) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), every);
    return () => clearInterval(id);
  }, [every]);
  return now;
}

export default function LateEntry({ start, doubles, closes, end, join, joinHref, nextHref }: {
  start: number; doubles: number; closes: number; end: number; join: string; joinHref: string; nextHref?: string;
}) {
  const router = useRouter();
  const now = useNow(1000);
  const phase = useRef<string>("");
  const p = now === null ? "" : now < doubles ? "grace" : now < closes ? "late" : now < end ? "closed" : "ended";
  // When the price changes or the doors close, fetch the page again so the button shows the real price.
  useEffect(() => {
    if (phase.current && p !== phase.current) router.refresh();
    phase.current = p;
  }, [p, router]);

  const total = end - start;
  const w = (a: number, b: number) => `${((b - a) / total) * 100}%`;
  const at = now === null ? 0 : Math.min(100, Math.max(0, ((now - start) / total) * 100));
  const left = now === null ? 0 : Math.max(0, Math.ceil(((p === "grace" ? doubles : closes) - now) / 1000));
  return (
    <section className={`fd-lateco ${p}`} aria-labelledby="fd-late-h">
      <div className="fd-lateco-h">
        <h2 id="fd-late-h">{p === "closed" || p === "ended" ? "Doors have closed" : "You can still join"}</h2>
        {p === "grace" && <span className="fd-pill ok" aria-live="off">Normal price for {mmss(left)} more</span>}
        {p === "late" && <span className="fd-pill warn" aria-live="off">Doors close in {mmss(left)}</span>}
      </div>
      <p>{p === "closed" || p === "ended"
        ? "Late entry stops 30 minutes before the end so nobody pays for a few minutes of film. Catch the next premiere instead."
        : "Join live at the current moment. After 15 minutes the late-entry seat costs double."}</p>
      <div className="fd-tl">
        <div className="fd-tl-bar" aria-hidden>
          <i className="a" style={{ width: w(start, doubles) }} />
          <i className="b" style={{ width: w(doubles, closes) }} />
          <i className="c" style={{ width: w(closes, end) }} />
          {now !== null && <b style={{ left: `${at}%` }} />}
        </div>
        <div className="fd-tl-lab">
          <span>{hm(start)} start</span>
          <span className="warn">{hm(doubles)} · price doubles</span>
          <span>{hm(closes)} · doors close</span>
          <span>{hm(end)} end</span>
        </div>
      </div>
      <div className="fd-lateco-b">
        {p !== "closed" && p !== "ended" && <Link href={joinHref} className="lp-btn lg">Join now · {join}</Link>}
        {nextHref && <Link href={nextHref} className="lp-btn lg ghost">Pre-order the next screening</Link>}
      </div>
    </section>
  );
}
