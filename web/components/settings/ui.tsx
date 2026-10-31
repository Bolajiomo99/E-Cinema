"use client";

import { useState } from "react";

// Shared pieces for the settings pages (Figma "Web / Settings" frames).

export class ApiError extends Error {
  status = 0;
}

export async function call(path: string, method: string, body?: unknown) {
  const res = await fetch(path, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = new ApiError(data.error ? data.error[0].toUpperCase() + data.error.slice(1) : "Something went wrong, please try again");
    e.status = res.status;
    throw e;
  }
  return data;
}

export function Card({ title, aside, children }: { title: string; aside?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="st-card">
      <header><h2>{title}</h2>{aside && <span className="st-aside">{aside}</span>}</header>
      {children}
    </section>
  );
}

export function Row({ title, sub, children, tag }: { title: React.ReactNode; sub?: React.ReactNode; children?: React.ReactNode; tag?: React.ReactNode }) {
  return (
    <div className="st-row">
      <div className="st-row-t"><strong>{title}{tag}</strong>{sub && <small>{sub}</small>}</div>
      {children && <div className="st-row-c">{children}</div>}
    </div>
  );
}

export function Toggle({ on, onChange, label, disabled }: { on: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} disabled={disabled} className={`st-toggle${on ? " on" : ""}`} onClick={() => onChange(!on)}>
      <i />
    </button>
  );
}

export function Pill({ tone = "green", children }: { tone?: "green" | "red" | "grey"; children: React.ReactNode }) {
  return <span className={`st-pill ${tone}`}>{children}</span>;
}

export function Soon() {
  return <span className="soon-tag">Soon</span>;
}

export function Notice({ text, tone = "ok" }: { text: string; tone?: "ok" | "err" }) {
  return text ? <p className={`st-notice ${tone}`} role={tone === "err" ? "alert" : "status"}>{text}</p> : null;
}

// Saves preferences as they change, with one status line for the page.
export function usePrefs(initial: Record<string, unknown>) {
  const [prefs, setPrefs] = useState(initial);
  const [msg, setMsg] = useState<{ text: string; tone: "ok" | "err" }>({ text: "", tone: "ok" });
  const set = async (key: string, value: unknown) => {
    const before = prefs[key];
    setPrefs((p) => ({ ...p, [key]: value }));
    try {
      await call("/api/settings/settings", "PATCH", { prefs: { [key]: value } });
      setMsg({ text: "Saved", tone: "ok" });
    } catch (e) {
      setPrefs((p) => ({ ...p, [key]: before }));
      setMsg({ text: (e as Error).message, tone: "err" });
    }
  };
  return { prefs, set, msg };
}
