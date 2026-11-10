"use client";

import { useEffect, useState } from "react";
import { localZoneName } from "@/lib/zone-abbr";

const fmt = (iso: string, timeZone?: string, opts: Intl.DateTimeFormatOptions = {}) =>
  new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", ...opts }).format(new Date(iso));

// "Tonight · 20:00 WAT" in the viewer's zone, plus the same moment in London and Mumbai.
export default function WorldTimes({ iso }: { iso: string }) {
  const [zone, setZone] = useState<string | undefined>("UTC");
  useEffect(() => setZone(undefined), []);
  const d = new Date(iso);
  const day = new Intl.DateTimeFormat("en-GB", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" });
  const today = day.format(new Date()) === day.format(d);
  const label = today ? "Tonight" : new Intl.DateTimeFormat("en-GB", { timeZone: zone, weekday: "short", day: "numeric", month: "short" }).format(d);
  return (
    <>
      <p className="ok-v">{label} · {zone === "UTC" ? fmt(iso, zone, { timeZoneName: "short" }) : localZoneName(fmt(iso, zone, { timeZoneName: "short" }))}</p>
      <p className="ok-s">{fmt(iso, "Europe/London")} in London · {fmt(iso, "Asia/Kolkata")} in Mumbai · {fmt(iso, "Africa/Lagos")} in Lagos</p>
    </>
  );
}
