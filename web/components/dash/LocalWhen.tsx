"use client";

import { useEffect, useState } from "react";

// Shows a screening time in the viewer's own time zone. The server cannot know it,
// so the first render prints UTC and the browser swaps in local time after mount.
export default function LocalWhen({ iso, suffix = "" }: { iso: string; suffix?: string }) {
  const [text, setText] = useState(() => fmt(iso, "UTC"));
  useEffect(() => setText(fmt(iso)), [iso]);
  return <>{text}{suffix}</>;
}

function fmt(iso: string, timeZone?: string) {
  const d = new Date(iso);
  const day = new Intl.DateTimeFormat("en-GB", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" });
  const same = (a: Date) => day.format(a) === day.format(d);
  const now = new Date();
  const tomorrow = new Date(now.getTime() + 86400000);
  const label = same(now) ? "Tonight" : same(tomorrow) ? "Tomorrow" : new Intl.DateTimeFormat("en-GB", { timeZone, weekday: "short", day: "numeric", month: "short" }).format(d);
  const time = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", timeZoneName: "short" }).format(d);
  return `${label} · ${time}`;
}
