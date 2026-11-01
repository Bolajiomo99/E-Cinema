"use client";
import { useState } from "react";
import { Bars, LineChart } from "@/components/licensing/Charts";
import { nameOf } from "@/lib/countries";
import { money, monthLabel } from "@/lib/studio-types";

// "Gross ticket revenue" with its three chips (Figma 34:132): the last 12 months, each film,
// and where seats were bought.
export default function RevenuePanel({ months, films, countries, currency }: {
  months: { month: string; grossCents: number }[];
  films: { film: string; grossCents: number }[];
  countries: { key: string; seats: number }[];
  currency: string;
}) {
  const [view, setView] = useState<"months" | "film" | "country">("months");
  const label = monthLabel;
  const byFilm = [...films.reduce((a, f) => a.set(f.film, (a.get(f.film) ?? 0) + f.grossCents), new Map<string, number>())]
    .sort((a, b) => b[1] - a[1]).slice(0, 6);
  const filmTotal = byFilm.reduce((a, [, v]) => a + v, 0) || 1;
  const seatTotal = countries.reduce((a, c) => a + c.seats, 0) || 1;
  return (
    <section className="bp-panel stu-rev">
      <div className="stu-h">
        <h2>Gross ticket revenue</h2>
        <div className="bp-chips" role="tablist" aria-label="Revenue view">
          {([["months", "12 months"], ["film", "By film"], ["country", "By country"]] as const).map(([k, t]) => (
            <button key={k} role="tab" aria-selected={view === k} className={view === k ? "on" : ""} onClick={() => setView(k)}>{t}</button>
          ))}
        </div>
      </div>
      {view === "months" && (months.some((m) => m.grossCents > 0)
        ? <LineChart points={months.map((m) => m.grossCents)} labels={months.map((m) => label(m.month))} color="#d4a23a" label="Gross ticket revenue by month" />
        : <p className="pt-empty">Ticket revenue shows here from your first premiere.</p>)}
      {view === "film" && <Bars rows={byFilm.map(([name, value]) => ({ name, value, pct: Math.round((value / filmTotal) * 100) }))} color="#d4a23a" format={(s) => money(s.value, currency, true)} />}
      {view === "country" && <Bars rows={countries.map((c) => ({ name: nameOf(c.key), value: c.seats, pct: Math.round((c.seats / seatTotal) * 100) }))} color="#d4a23a" format={(s) => `${s.value.toLocaleString("en-GB")} seats`} />}
    </section>
  );
}
