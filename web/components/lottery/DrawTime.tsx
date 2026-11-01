"use client";

import { useEffect, useState } from "react";

// "21:30 · draw time WAT": the draw time in the viewer's own zone.
export default function DrawTime({ iso }: { iso: string }) {
  const [tz, setTz] = useState<string | undefined>("UTC");
  useEffect(() => setTz(undefined), []);
  const d = new Date(iso);
  const time = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: tz }).format(d);
  const zone = new Intl.DateTimeFormat("en-GB", { timeZoneName: "short", timeZone: tz }).formatToParts(d).find((p) => p.type === "timeZoneName")?.value ?? "";
  return (
    <>
      <b suppressHydrationWarning>{time}</b>
      <small suppressHydrationWarning>draw time {zone}</small>
    </>
  );
}
