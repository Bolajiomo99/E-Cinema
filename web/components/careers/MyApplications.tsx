"use client";
import Link from "next/link";
import { useState } from "react";
import { STAGES, type Application } from "@/lib/careers-types";

const future = (iso: string) => Date.parse(iso) > Date.now();

// Each application with its hiring steps, the next interview and any message from the team.
export default function MyApplications({ initial, tz }: { initial: Application[]; tz: string }) {
  const [apps, setApps] = useState(initial);
  const [err, setErr] = useState("");
  const day = (iso: string) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: tz }).format(new Date(iso));
  // Built from parts so the server and every browser print the same text.
  const when = (iso: string) => {
    const parts = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: tz }).formatToParts(new Date(iso)).map((x) => [x.type, x.value]));
    return `${parts.weekday} ${parts.day} ${parts.month}, ${parts.hour}:${parts.minute} ${tz === "Africa/Lagos" ? "WAT" : "UTC"}`;
  };

  async function withdraw(a: Application) {
    if (!window.confirm(`Withdraw your application for ${a.job.title}?`)) return;
    const r = await fetch(`/api/careers/applications/${a.id}/withdraw`, { method: "POST" });
    if (!r.ok) return setErr("Could not withdraw. Try again.");
    setApps((l) => l.map((x) => (x.id === a.id ? { ...x, stage: "closed", message: "You withdrew this application." } : x)));
  }

  function ics(a: Application) {
    const start = new Date(a.interviewAt!);
    const end = new Date(start.getTime() + 30 * 60_000);
    const f = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
    const text = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//E-Cinema//Careers//EN", "BEGIN:VEVENT", `UID:${a.id}@e-cinema.net`, `DTSTAMP:${f(new Date())}`,
      `DTSTART:${f(start)}`, `DTEND:${f(end)}`, `SUMMARY:E-Cinema interview: ${a.job.title}`, `DESCRIPTION:Video call with ${a.interviewWith || "the hiring team"}`, "END:VEVENT", "END:VCALENDAR"].join("\r\n");
    const a2 = document.createElement("a");
    a2.href = URL.createObjectURL(new Blob([text], { type: "text/calendar" }));
    a2.download = "e-cinema-interview.ics";
    a2.click();
    URL.revokeObjectURL(a2.href);
  }

  if (apps.length === 0) return <div className="cr-empty"><b>You have not applied for a role yet.</b><p><Link href="/careers/jobs">See open roles</Link></p></div>;
  return (
    <>
      {err && <p className="rf-note bad" role="alert">{err}</p>}
      <div className="ma-grid">
        {apps.map((a) => {
          const closed = a.stage === "closed";
          const hired = a.stage === "hired";
          const at = STAGES.findIndex(([s]) => s === a.stage);
          const reached = (i: number) => hired || i <= at;
          const ev = (s: string) => (a.events ?? []).filter((e) => e.stage === s).at(-1);
          const upcoming = a.interviewAt && future(a.interviewAt) && !closed;
          return (
            <section key={a.id} className={`ma-card ${closed ? "closed" : ""}`}>
              <header>
                <h2>{a.job.title}</h2>
                <span className={`ma-state ${closed ? "off" : hired ? "ok" : ""}`}>{closed ? "Closed" : hired ? "Hired" : "In progress"}</span>
              </header>
              <p className="ma-sub">Applied {day(a.createdAt)} · {a.job.city} · {a.job.quota === "ng" ? "Nigeria role" : "Open worldwide"}</p>
              {closed ? <p className="ma-msg">{a.message || "This application is closed."}</p> : (
                <ol className="ma-steps">
                  {STAGES.map(([s, label], i) => {
                    const e = ev(s);
                    const sub = s === "received" ? day(a.createdAt)
                      : s === "chat" && a.interviewAt && at >= 1 ? `${day(a.interviewAt)}, 30 minutes`
                      : s === "task" && a.taskDue && at >= 2 ? `Due ${day(a.taskDue)}${a.taskPay ? ` · ${a.taskPay}` : ""}`
                      : e ? day(e.at) : "";
                    return <li key={s} className={reached(i) ? (i === at && !hired ? "now" : "done") : ""}><b>{label}</b>{sub && <small>{sub}</small>}</li>;
                  })}
                </ol>
              )}
              {!closed && a.message && <p className="ma-msg">{a.message}</p>}
              {upcoming && (
                <div className="ma-meet">
                  <div><b>Interview booked</b><span>{when(a.interviewAt!)}</span><small>Video call · {a.interviewWith || "The hiring team"}</small></div>
                  <button type="button" className="vf-btn ghost" onClick={() => ics(a)}>Add to calendar</button>
                </div>
              )}
              <div className="ma-acts">
                <Link className="vf-btn ghost" href={`/careers/jobs/${a.job.slug}`}>View role</Link>
                {!closed && !hired && <button type="button" className="vf-btn ghost" onClick={() => withdraw(a)}>Withdraw</button>}
              </div>
            </section>
          );
        })}
      </div>
    </>
  );
}
