"use client";

import dynamic from "next/dynamic";

// Bryntum touches the DOM when it loads, so it only renders in the browser.
const Calendar = dynamic(() => import("./CalendarView"), { ssr: false });

export default function ReleaseCalendar() {
  return <Calendar />;
}
