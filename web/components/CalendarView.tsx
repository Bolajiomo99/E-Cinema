"use client";

import { useState } from "react";
import { BryntumCalendar, type BryntumCalendarProps } from "@bryntum/calendar-react";

// Sample premieres until the catalogue API is live. Films and studios are invented.
const resources = [
  { id: "nollywood", name: "Nollywood", eventColor: "red" },
  { id: "kdrama", name: "K-drama", eventColor: "purple" },
  { id: "anime", name: "Anime", eventColor: "orange" },
  { id: "documentary", name: "Documentary", eventColor: "teal" },
];

const events = [
  { id: 1, name: "Red Earth: world premiere", resourceId: "nollywood", startDate: "2026-11-02T19:00", endDate: "2026-11-02T21:15" },
  { id: 2, name: "Seoul After Rain", resourceId: "kdrama", startDate: "2026-11-03T13:00", endDate: "2026-11-03T14:50" },
  { id: 3, name: "Lagos Lights: late show", resourceId: "nollywood", startDate: "2026-11-04T21:30", endDate: "2026-11-04T23:40" },
  { id: 4, name: "Paper Moon Riders", resourceId: "anime", startDate: "2026-11-05T17:00", endDate: "2026-11-05T18:40" },
  { id: 5, name: "The Last Glacier", resourceId: "documentary", startDate: "2026-11-06T20:00", endDate: "2026-11-06T21:30" },
  { id: 6, name: "Seoul After Rain: encore", resourceId: "kdrama", startDate: "2026-11-07T10:00", endDate: "2026-11-07T11:50" },
];

export default function CalendarView() {
  const [calendarProps] = useState<BryntumCalendarProps>({
    date: new Date(2026, 10, 2),
    mode: "week",
    resources,
    events,
  });

  return <BryntumCalendar {...calendarProps} />;
}
