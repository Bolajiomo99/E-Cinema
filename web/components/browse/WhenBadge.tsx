"use client";

import { useEffect, useState } from "react";

// Poster corner badge from Figma (FRI 18:00 / TONIGHT / NEXT MON / LIVE), in the viewer's own
// time zone, so it is worked out in the browser after the page loads.
export default function WhenBadge({ startsAt, endsAt }: { startsAt: string; endsAt: number }) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);
  if (now === null) return null;
  const t = new Date(startsAt);
  if (now >= t.getTime() && now < endsAt) return <span className="br-badge live"><i />LIVE</span>;
  const day = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((day(t) - day(new Date(now))) / 86_400_000);
  const hm = t.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
  const wd = t.toLocaleDateString("en", { weekday: "short" }).toUpperCase();
  const label = days === 0 ? (t.getHours() >= 17 ? "TONIGHT" : `TODAY ${hm}`) : days === 1 ? `TOMORROW ${hm}` : days < 7 ? `${wd} ${hm}` : days < 14 ? `NEXT ${wd}` : t.toLocaleDateString("en", { day: "numeric", month: "short" }).toUpperCase();
  return <span className={`br-badge${days <= 1 ? " soon" : ""}`}>{label}</span>;
}
