"use client";

import { useEffect, useState } from "react";

// The amber "09:42 left" pill from Figma 96:1254. Counts down to the hold's real expiry.
export default function HoldTimer({ until }: { until: string }) {
  const end = Date.parse(until);
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  if (now === null) return <span className="pf-pill">Held</span>;
  const left = Math.max(0, Math.floor((end - now) / 1000));
  if (left === 0) return <span className="pf-pill off">Hold ended</span>;
  const mm = String(Math.floor(left / 60)).padStart(2, "0");
  const ss = String(left % 60).padStart(2, "0");
  return <span className="pf-pill" role="timer" aria-live="off">{mm}:{ss} left</span>;
}
