"use client";

import { useMemo, useRef, useState } from "react";
import { BryntumCalendar, type BryntumCalendarProps } from "@bryntum/calendar-react";
import type { DomConfig, EventModel, WeekViewConfig } from "@bryntum/calendar";
import { showtimes } from "@/lib/catalog";

// Genres double as Bryntum resources so each one gets its own colour.
const genres = [
  { id: "nollywood", name: "Nollywood", eventColor: "#e3182d" },
  { id: "bollywood", name: "Bollywood", eventColor: "#f2a516" },
  { id: "hollywood", name: "Hollywood", eventColor: "#4696ff" },
  { id: "kdrama", name: "K-drama", eventColor: "#9b6bff" },
  { id: "adult", name: "18+", eventColor: "#b91c1c" },
  { id: "anime", name: "Anime", eventColor: "#ff8a3d" },
  { id: "documentary", name: "Documentary", eventColor: "#2bb7a8" },
];

type Premiere = {
  id: string;
  name: string;
  resourceId: string;
  startDate: string;
  minutes: number;
  studio: string;
  tagline: string;
  audio: string[];
};

// Bookable screenings come from the catalogue; the rest are announced titles with tickets coming soon.
// All films and studios are invented. Times are UTC, so every viewer sees their own local time.
const taglines: Record<string, string> = {
  "tide-of-lagos-2026-11-01": "A ferry captain, a storm and the last crossing of the night.",
  "monsoon-hearts-2026-11-01": "Two wedding singers, one monsoon, a hundred songs.",
  "the-last-harmattan-2026-11-01": "When the dust settles over Kano, someone will not come home.",
  "orbit-zero-2026-11-01": "Six astronauts wake up with no record of the launch.",
  "the-kano-ledger-2026-11-02": "An accountant finds one number that could topple a city.",
  "red-earth-2026-11-02": "A drought, a debt and a family that will not sell the land.",
  "velvet-hour-2026-11-02": "One Paris hotel bar, one night, verified adults only.",
  "seoul-after-rain-2026-11-03": "Two strangers share one umbrella and a very long night.",
  "lagos-lights-2026-11-04": "One night on the island, three hustles, no sleep.",
};
const genreOf = (s: (typeof showtimes)[number]) =>
  s.adult ? "adult" : s.category === "K-Drama" ? "kdrama" : s.category === "Bollywood" ? "bollywood" : s.category === "Hollywood" ? "hollywood" : "nollywood";
const code = (lang?: string) => (lang ?? "English").slice(0, 2).toUpperCase();

const premieres: Premiere[] = [
  ...showtimes.map((s) => ({
    id: s.id, name: s.film, resourceId: genreOf(s), startDate: s.startsAt, minutes: s.runtimeMin ?? 120, studio: s.studio,
    tagline: taglines[s.id] ?? "", audio: [code(s.language), ...(s.dubs ? [`+${s.dubs} dubs`] : [])],
  })),
  { id: "paper-moon-riders", name: "Paper Moon Riders", resourceId: "anime", startDate: "2026-11-05T16:00:00Z", minutes: 100, studio: "Kumo Frame Studio", tagline: "Couriers on kites racing a storm across the sky city.", audio: ["JA", "EN"] },
  { id: "the-last-glacier", name: "The Last Glacier", resourceId: "documentary", startDate: "2026-11-06T19:00:00Z", minutes: 90, studio: "North Ledger Films", tagline: "A year on the ice with the people who measure it.", audio: ["EN"] },
  { id: "seoul-after-rain-encore", name: "Seoul After Rain · encore", resourceId: "kdrama", startDate: "2026-11-07T09:00:00Z", minutes: 110, studio: "Hanbit Story House", tagline: "Missed it? One more screening for late risers.", audio: ["KO", "EN"] },
];

const bookable = new Map(showtimes.map((s) => [s.id, s]));
const time = (d: Date) => d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
const day = (d: Date) => d.toLocaleDateString([], { weekday: "long", day: "numeric", month: "long" });
const hm = (m: number) => `${Math.floor(m / 60)}h ${m % 60}m`;


// Bryntum renderers are set per view; this one draws the title, time, price and audio languages.
function renderPremiere({ eventRecord }: { eventRecord: EventModel }, compact = false): DomConfig | DomConfig[] {
      const p = eventRecord as unknown as EventModel & Premiere;
      const show = bookable.get(p.id as string);
      if (compact) return { tag: "span", text: p.name };
      return [
        { tag: "div", className: "ec-ev-title", text: p.name },
        { tag: "div", className: "ec-ev-meta", text: `${hm(p.minutes)} · ${p.studio}` },
        {
          tag: "div",
          className: "ec-ev-foot",
          children: [
            { tag: "span", className: show ? "ec-pill sale" : "ec-pill", text: show ? `${show.price.currency} ${show.price.value}` : "Soon" },
            ...p.audio.map((a) => ({ tag: "span", className: "ec-lang", text: a })),
          ],
        },
      ];
    }

type Renderer = NonNullable<WeekViewConfig["eventRenderer"]>;
const premiereRenderer = ((ctx: { eventRecord: EventModel }) => renderPremiere(ctx)) as unknown as Renderer;
const titleRenderer = ((ctx: { eventRecord: EventModel }) => renderPremiere(ctx, true)) as unknown as Renderer;

type Mode = "agenda" | "week" | "month";

export default function CalendarView() {
  const ref = useRef<BryntumCalendar>(null);
  const [genre, setGenre] = useState<string>("all");
  const [mode] = useState<Mode>(() =>
    typeof window !== "undefined" && window.matchMedia("(max-width: 720px)").matches ? "agenda" : "week",
  );

  const events = useMemo(
    () =>
      premieres.map((p) => {
        const start = new Date(p.startDate);
        return { ...p, startDate: start, endDate: new Date(start.getTime() + p.minutes * 60000), cls: bookable.has(p.id) ? "on-sale" : "soon" };
      }),
    [],
  );

  const [config] = useState<BryntumCalendarProps>(() => ({
    date: new Date(premieres[0].startDate),
    mode,
    readOnly: true,
    sidebar: false,
    weekStartDay: 1,
    eventEditFeature: false,
    dragFeature: false,
    eventMenuFeature: false,
    scheduleMenuFeature: false,
    tbar: { hidden: false },
    modes: {
      day: null,
      year: null,
      list: null,
      week: { dayStartTime: 8, dayEndTime: 24, hourHeight: 64, eventRenderer: premiereRenderer },
      month: { eventRenderer: titleRenderer },
      agenda: { range: "month" as const, eventRenderer: titleRenderer },
    },
    eventTooltipFeature: {
      showOn: "hover" as const,
      align: "l-r",
      tools: { edit: false, delete: false },
      titleRenderer: (e: EventModel) => ({ tag: "strong", text: e.name }),
      renderer({ eventRecord }: { eventRecord: EventModel }) {
        const p = eventRecord as unknown as EventModel & Premiere;
        const show = bookable.get(p.id as string);
        return {
          className: "ec-tip",
          children: [
            { tag: "p", className: "ec-tip-studio", text: p.studio },
            { tag: "p", text: p.tagline },
            { tag: "p", className: "ec-tip-when", text: `${day(p.startDate as Date)} · ${time(p.startDate as Date)} your time · ${hm(p.minutes)}` },
            { tag: "p", className: "ec-tip-audio", text: `Audio: ${p.audio.join(", ")}` },
            show
              ? { tag: "a", className: "ec-tip-cta", href: `/checkout?film=${p.id}`, text: `Get a seat · ${show.price.currency} ${show.price.value}` }
              : { tag: "span", className: "ec-tip-soon", text: "Tickets open soon" },
          ],
        };
      },
    },
    onEventClick({ eventRecord }) {
      if (bookable.has(eventRecord.id as string)) window.location.assign(`/checkout?film=${eventRecord.id}`);
    },
  }));

  const counts = useMemo(() => Object.fromEntries(genres.map((g) => [g.id, premieres.filter((p) => p.resourceId === g.id).length])), []);

  function pickGenre(id: string) {
    setGenre(id);
    const store = ref.current?.instance.eventStore;
    if (!store) return;
    if (id === "all") store.removeFilter("genre");
    else store.filter({ id: "genre", filterBy: (e: EventModel) => e.resourceId === id });
  }

  function jumpToNext() {
    const now = Date.now();
    const next = premieres.find((p) => Date.parse(p.startDate) > now) ?? premieres[0];
    if (ref.current) ref.current.instance.date = new Date(next.startDate);
  }

  return (
    <div className="ec-cal">
      <header className="ec-cal-head">
        <div>
          <p className="eyebrow">Release calendar</p>
          <h1>What&apos;s premiering</h1>
          <p className="muted">Every screening happens once, at the same moment for everyone. Times are shown in your time zone.</p>
        </div>
        <div className="ec-cal-tools">
          <button className="nav-btn" onClick={jumpToNext}>Next premiere</button>
        </div>
      </header>
      <div className="ec-chips" role="group" aria-label="Filter by genre">
        <button className={genre === "all" ? "on" : ""} onClick={() => pickGenre("all")}>
          All <b>{premieres.length}</b>
        </button>
        {genres.map((g) => (
          <button key={g.id} className={genre === g.id ? "on" : ""} onClick={() => pickGenre(g.id)} style={{ ["--dot" as string]: g.eventColor }}>
            <i />
            {g.name} <b>{counts[g.id]}</b>
          </button>
        ))}
      </div>
      <div className="ec-cal-frame">
        <BryntumCalendar ref={ref} {...config} resources={genres} events={events} />
      </div>
      <p className="ec-cal-legend muted">
        <span className="ec-pill sale">USD 6.99</span> on sale now, tap to book · <span className="ec-pill">Soon</span> announced, tickets open soon
      </p>
    </div>
  );
}
