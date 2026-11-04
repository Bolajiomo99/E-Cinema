"use client";

import { useEffect, useState } from "react";

// "PREMIERE · TONIGHT" / "ENCORE · TOMORROW" / "PREMIERE · SAT 7 NOV", in the viewer's own time zone.
// Each lineup film comes back weekly as an encore, so the badge no longer says "once".
export default function HeroWhen({ startsAt, encore = false }: { startsAt: string; encore?: boolean }) {
  const [text, setText] = useState("SOON");
  useEffect(() => {
    const t = setTimeout(() => {
      const start = new Date(startsAt), now = new Date(), tomorrow = new Date(Date.now() + 86_400_000);
      if (start.toDateString() === now.toDateString()) setText("TONIGHT");
      else if (start.toDateString() === tomorrow.toDateString()) setText("TOMORROW");
      else setText(`${start.toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" }).toUpperCase()}`);
    }, 0);
    return () => clearTimeout(t);
  }, [startsAt]);
  return <span className="lp-badge outline">{encore ? "ENCORE" : "PREMIERE"} · {text}</span>;
}
