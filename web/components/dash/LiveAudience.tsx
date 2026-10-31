"use client";

import { useEffect, useState } from "react";

const n = (v: number) => v.toLocaleString("en-US");

// "48,211 WATCHING · 96 COUNTRIES" from Figma Home (17:322), refreshed while the page is open.
export default function LiveAudience({ showtimeId, initial }: { showtimeId: string; initial?: { watching: number; countries: number } }) {
  const [s, setS] = useState(initial ?? { watching: 0, countries: 0 });
  useEffect(() => {
    let stop = false;
    const tick = async () => {
      if (document.hidden) return;
      const list = (await fetch("/api/live").then((r) => r.json()).catch(() => null)) as { showtimeId: string; watching: number; countries: number }[] | null;
      if (stop || !list) return;
      const mine = list.find((x) => x.showtimeId === showtimeId);
      setS(mine ? { watching: mine.watching, countries: mine.countries } : { watching: 0, countries: 0 });
    };
    const id = setInterval(tick, 10_000);
    return () => { stop = true; clearInterval(id); };
  }, [showtimeId]);
  if (!s.watching) return <span className="lp-badge outline">ROOM OPEN · BE THE FIRST IN</span>;
  return (
    <span className="lp-badge outline" aria-live="polite">
      {n(s.watching)} WATCHING{s.countries > 0 && ` · ${n(s.countries)} ${s.countries === 1 ? "COUNTRY" : "COUNTRIES"}`}
    </span>
  );
}
