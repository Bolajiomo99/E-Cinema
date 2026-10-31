"use client";

import { useEffect, useState } from "react";

const pad = (n: number) => String(Math.max(0, n)).padStart(2, "0");

export default function Countdown({ to }: { to: string }) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const first = setTimeout(tick, 0);
    const t = setInterval(tick, 1000);
    return () => { clearTimeout(first); clearInterval(t); };
  }, []);
  const left = now === null ? 0 : Math.max(0, Math.floor((Date.parse(to) - now) / 1000));
  const d = Math.floor(left / 86400);
  const parts = d > 0
    ? [[d, "DAYS"], [Math.floor((left % 86400) / 3600), "HRS"], [Math.floor((left % 3600) / 60), "MIN"]]
    : [[Math.floor(left / 3600), "HRS"], [Math.floor((left % 3600) / 60), "MIN"], [left % 60, "SEC"]];
  return (
    <div className="countdown" aria-label="Time until the screening starts">
      {parts.map(([v, label]) => (
        <div key={label as string}>
          <strong>{now === null ? "--" : pad(v as number)}</strong>
          <span>{label}</span>
        </div>
      ))}
    </div>
  );
}
