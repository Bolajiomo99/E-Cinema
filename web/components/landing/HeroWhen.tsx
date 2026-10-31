"use client";

import { useEffect, useState } from "react";

// "TONIGHT ONLY" / "TOMORROW ONLY" / "SAT 7 NOV ONLY", worked out in the viewer's own time zone.
export default function HeroWhen({ startsAt }: { startsAt: string }) {
  const [text, setText] = useState("ONE NIGHT ONLY");
  useEffect(() => {
    const t = setTimeout(() => {
      const start = new Date(startsAt), now = new Date(), tomorrow = new Date(Date.now() + 86_400_000);
      if (start.toDateString() === now.toDateString()) setText("TONIGHT ONLY");
      else if (start.toDateString() === tomorrow.toDateString()) setText("TOMORROW ONLY");
      else setText(`${start.toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" }).toUpperCase()} ONLY`);
    }, 0);
    return () => clearTimeout(t);
  }, [startsAt]);
  return <span className="lp-badge outline">SCREENING ONCE · {text}</span>;
}
