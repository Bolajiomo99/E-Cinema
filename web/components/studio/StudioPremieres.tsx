"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { MARKETS, marketOf, parsePrice, showPrice, STARTER, type Premiere, type PremiereMode, type PremierePrice } from "@/lib/premiere-types";
import type { Upload } from "@/lib/studio-types";
import { scall } from "./scall";
import StudioEncores from "./StudioEncores";

// Figma "Studio / Premieres and pricing" (35:514): when the film screens, how many seats, the
// house rules and a price per country. Publishing puts the film on sale on the site.

type Row = { country: string; text: string; note: string; sold: number };
type Rules = Pick<Premiere, "freeSeats" | "freePlan" | "groupDiscounts" | "studentPrice" | "classicRequests" | "downloads">;

const MODES: { id: PremiereMode; label: string }[] = [
  { id: "global", label: "One global moment" },
  { id: "rolling", label: "Rolling, 21:00 local in each country" },
  { id: "waves", label: "3 waves by region" },
];
const CITIES: [string, string][] = [["Lagos", "Africa/Lagos"], ["Berlin", "Europe/Berlin"], ["Mumbai", "Asia/Kolkata"], ["Tokyo", "Asia/Tokyo"], ["São Paulo", "America/Sao_Paulo"]];
const RULES: { key: keyof Rules; title: string; sub: string }[] = [
  { key: "freePlan", title: "Free plan can watch", sub: "Muted after 3 minutes of talk" },
  { key: "groupDiscounts", title: "Group discounts (VIP)", sub: "Up to 25% off for 10+ seats" },
  { key: "studentPrice", title: "Student price", sub: "30% off with verified student ID" },
  { key: "classicRequests", title: "Classic requests after screening", sub: "Unlock at 500 requests" },
  { key: "downloads", title: "Downloads", sub: "Not for premieres. Allowed 30 days after" },
];
const RUNTIME = /(?:(\d+)h )?(\d+)m(?: \d+s)?$/;

const pad = (n: number) => String(n).padStart(2, "0");
// The value a datetime-local input shows, in the studio's own time zone.
function localInput(iso: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function at(iso: string, zone: string, day: boolean) {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: zone, weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(iso));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return day ? `${get("weekday")} ${get("hour")}:${get("minute")}` : `${get("hour")}:${get("minute")}`;
}

function Toggle({ on, label, disabled, onChange }: { on: boolean; label: string; disabled?: boolean; onChange: (v: boolean) => void }) {
  return <button type="button" role="switch" aria-checked={on} aria-label={label} className={`stpr-tg${on ? " on" : ""}`} disabled={disabled} onClick={() => onChange(!on)}><i /></button>;
}

export default function StudioPremieres({ films, upload: u, premiere: p0, canEdit, rightsDeclared, rates }: {
  films: { id: string; title: string }[]; upload: Upload; premiere: Premiere; canEdit: boolean; rightsDeclared: boolean; rates: Record<string, number> | null;
}) {
  const router = useRouter();
  const [p, setP] = useState(p0);
  const [when, setWhen] = useState(localInput(p0.startsAt));
  const [mode, setMode] = useState<PremiereMode>(p0.mode);
  const [seats, setSeats] = useState(String(p0.seats));
  const [encores, setEncores] = useState(p0.encores);
  const [base, setBase] = useState((p0.priceCents / 100).toFixed(2));
  const [rules, setRules] = useState<Rules>({ freeSeats: p0.freeSeats, freePlan: p0.freePlan, groupDiscounts: p0.groupDiscounts, studentPrice: p0.studentPrice, classicRequests: p0.classicRequests, downloads: p0.downloads });
  const toRows = (list: PremierePrice[]): Row[] => [...list].sort((a, b) => MARKETS.findIndex((m) => m.country === a.country) - MARKETS.findIndex((m) => m.country === b.country)).flatMap((x) => { const m = marketOf(x.country); return m ? [{ country: x.country, text: showPrice(m, x.amountMinor), note: x.note, sold: x.sold }] : []; });
  const [rows, setRows] = useState<Row[]>(() => p0.prices.length || p0.publishedAt ? toRows(p0.prices) : STARTER.map((c) => ({ country: c, text: "", note: "", sold: 0 })));
  const [busy, setBusy] = useState<"" | "save" | "publish" | "ai">("");
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");

  const master = u.files.find((f) => f.kind === "master" && f.status === "uploaded");
  const rt = master ? RUNTIME.exec(master.info) : null;
  const durationMin = rt ? Number(rt[1] ?? 0) * 60 + Number(rt[2]) : 0;
  // Untouched, the saved time is used as is so the server and browser render the same text.
  const startsAt = when === localInput(p0.startsAt) ? p0.startsAt : when ? new Date(when).toISOString() : null;
  const live = Boolean(p.publishedAt && p.showtimeId);
  const missing = MARKETS.filter((m) => !rows.some((r) => r.country === m.country));
  const blockers = [!master && "upload the picture master", !rightsDeclared && "declare your rights in Settings", !startsAt && "pick a date and time", mode !== "global" && "pick one global moment"].filter(Boolean) as string[];

  const parsed = useMemo(() => rows.map((r) => { const m = marketOf(r.country)!; return { r, m, minor: r.text.trim() ? parsePrice(m, r.text) : null }; }), [rows]);
  const usd = (cur: string, minor: number, digits: number) => { const rate = rates?.[cur]; return rate ? `$${(minor / 10 ** digits / rate).toFixed(2)}` : "–"; };
  const set = (i: number, patch: Partial<Row>) => setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  function payload(publish: boolean) {
    const bad = parsed.find((x) => x.r.text.trim() && !x.minor);
    if (bad) throw new Error(`Check the price for ${bad.m.name}`);
    const cents = Math.round(Number(base) * 100);
    if (!Number.isFinite(cents) || cents < 99) throw new Error("The base price must be at least $0.99");
    return {
      mode, startsAt, seats: Number(seats.replace(/[^\d]/g, "")), encores, priceCents: cents, ...rules, durationMin, publish,
      prices: parsed.filter((x) => x.minor).map((x) => ({ country: x.m.country, currency: x.m.currency, amountMinor: x.minor, note: x.r.note })),
    };
  }
  async function save(publish: boolean) {
    setErr(""); setMsg("");
    try {
      const body = payload(publish);
      setBusy(publish ? "publish" : "save");
      const r = await scall<{ premiere: Premiere }>("PUT", `uploads/${u.id}/premiere`, body);
      setP(r.premiere);
      setRows(toRows(r.premiere.prices));
      setMsg(publish ? (live ? "Changes published. The site shows them within a minute." : "Published. Your film is on sale.") : "Saved. Nothing changes on the site until you publish.");
      router.refresh();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(""); }
  }
  async function suggest() {
    setErr(""); setMsg(""); setBusy("ai");
    try {
      const r = await scall<{ suggestions: { country: string; price: number; note: string }[] }>("POST", `uploads/${u.id}/suggest-prices`, {
        priceCents: Math.round(Number(base) * 100), rows: parsed.map((x) => ({ country: x.m.country, amountMinor: x.minor })),
      });
      setRows(rows.map((row) => {
        const s = r.suggestions.find((x) => x.country === row.country);
        const m = marketOf(row.country)!;
        return s ? { ...row, text: showPrice(m, Math.round(s.price * 10 ** m.digits)), note: s.note } : row;
      }));
      setMsg("AI prices filled in. Check them, then publish.");
    } catch (e) { setErr((e as Error).message); } finally { setBusy(""); }
  }

  return (
    <div className="pt-body stpr">
      <header className="bp-head">
        <div>
          <h1>Premieres and pricing</h1>
          <p>{[u.title, u.genres, u.languages].filter(Boolean).join(" · ")}</p>
        </div>
        {canEdit && (
          <div className="pt-btns">
            <Link className="vf-btn ghost" href={`/studio/premieres/coming-soon?film=${u.id}`}>Coming-soon post</Link>
            <button className="vf-btn ghost" disabled={Boolean(busy)} onClick={() => save(false)}>{busy === "save" ? "Saving" : "Save"}</button>
            <button className="vf-btn red" disabled={Boolean(busy) || blockers.length > 0} onClick={() => save(true)}>{busy === "publish" ? "Publishing" : "Publish changes"}</button>
          </div>
        )}
      </header>
      {films.length > 1 && (
        <nav className="bp-chips" aria-label="Films">
          {films.map((f) => <Link key={f.id} className={`stpr-film${f.id === u.id ? " on" : ""}`} href={`/studio/premieres?film=${f.id}`} aria-current={f.id === u.id ? "page" : undefined}>{f.title}</Link>)}
        </nav>
      )}
      {live && p.showtimeId ? (
        <p className="bp-flash" role="status">On sale · <Link href={`/film/${p.showtimeId}`}>see the film page</Link>{p.sold ? ` · ${p.sold.toLocaleString("en-US")} seats sold` : ""}</p>
      ) : canEdit && blockers.length > 0 ? (
        <p className="pt-hint">To publish, {blockers.join(", ")}.{!master && <> <Link href={`/studio/upload/${u.id}`}>Go to upload</Link></>}</p>
      ) : null}
      {msg && <p className="bp-flash" role="status">{msg}</p>}
      {err && <p className="vf-err" role="alert">{err}</p>}

      <div className="stpr-row">
        <section className="bp-panel stpr-prem">
          <h2>Premiere</h2>
          <div className="stpr-pair">
            <label className="vf-field"><span>Date</span><div className="vf-box"><input type="datetime-local" suppressHydrationWarning value={when} onChange={(e) => setWhen(e.target.value)} disabled={!canEdit} /></div></label>
            <label className="vf-field"><span>Mode</span><div className="vf-box"><input value={MODES.find((m) => m.id === mode)!.label} readOnly tabIndex={-1} /></div></label>
          </div>
          <div className="bp-chips" role="radiogroup" aria-label="Mode">
            {MODES.map((m) => m.id === "global"
              ? <button key={m.id} type="button" role="radio" aria-checked={mode === m.id} className={mode === m.id ? "on" : ""} onClick={() => setMode(m.id)} disabled={!canEdit}>{m.label}</button>
              : <button key={m.id} type="button" role="radio" aria-checked="false" disabled title="Coming soon">{m.label} <em className="soon-tag">Soon</em></button>)}
          </div>
          <p className="stpr-times">{startsAt ? `One global moment: ${CITIES.map(([c, z]) => `${at(startsAt, z, false)} ${c}`).join(" · ")}` : "Pick a date to see the start time around the world."}</p>
          <div className="stpr-pair">
            <label className="vf-field"><span>Seats worldwide</span><div className="vf-box"><input inputMode="numeric" value={seats} onChange={(e) => setSeats(e.target.value)} disabled={!canEdit} /></div></label>
            <label className="vf-field"><span>Encores after sell-out</span><div className="vf-box">
              <select value={encores} onChange={(e) => setEncores(Number(e.target.value))} disabled={!canEdit}>
                {[0, 1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n ? `Up to ${n}, studio approves` : "No encores"}</option>)}
              </select>
            </div></label>
          </div>
          {live && <StudioEncores upload={u.id} allowed={p.encores} canEdit={canEdit} />}
          <div className="stpr-free">
            <p>1,000 free seats if this sells out within 24 hours of the first sale (platform rule, paid by E‑Cinema). They are drawn by the sold-out lottery an hour before the film.</p>
            <Toggle label="1,000 free seats" on={rules.freeSeats} disabled={!canEdit} onChange={(v) => setRules({ ...rules, freeSeats: v })} />
          </div>
        </section>

        <section className="bp-panel stpr-rules">
          <h2>Rules</h2>
          {RULES.map((r) => (
            <div key={r.key} className="stpr-rule">
              <div><b>{r.title} <em className="soon-tag">Soon</em></b><small>{r.sub}</small></div>
              <Toggle label={r.title} on={rules[r.key]} disabled={!canEdit} onChange={(v) => setRules({ ...rules, [r.key]: v })} />
            </div>
          ))}
          <p className="pt-hint">Rules are saved with the premiere and switch on as each one goes live.</p>
        </section>
      </div>

      <section className="bp-panel stpr-prices">
        <div className="stpr-ph">
          <h2>Price by country</h2>
          <div className="bp-chips">
            <button type="button" className="on" aria-disabled="true">{rows.length} {rows.length === 1 ? "country" : "countries"}</button>
            {canEdit && <button type="button" onClick={suggest} disabled={Boolean(busy) || !rows.length}>{busy === "ai" ? "Asking Studio AI" : "Use AI suggested prices"}</button>}
          </div>
        </div>
        <div className="stpr-table" role="table" aria-label="Price by country">
          <div className="stpr-hdr" role="row">
            <span role="columnheader">Country</span><span role="columnheader">Currency</span><span role="columnheader">Ticket price</span><span role="columnheader">≈ USD</span>
            <span role="columnheader">Local start</span><span role="columnheader">Seats sold</span><span role="columnheader">Studio AI</span>
          </div>
          {parsed.map(({ r, m, minor }, i) => {
            const warn = r.note && !/^looks right/i.test(r.note);
            return (
              <div key={r.country} className="stpr-pr" role="row">
                <span role="cell" className="c">{m.country}  {m.name}</span>
                <span role="cell" className="cur">{m.currency}</span>
                <span role="cell"><input className="stpr-in" aria-label={`Ticket price in ${m.name}`} value={r.text} placeholder={`${m.symbol}…`} onChange={(e) => set(i, { text: e.target.value, note: "" })} onBlur={() => minor && set(i, { text: showPrice(m, minor) })} disabled={!canEdit} /></span>
                <span role="cell" className="s">{minor ? usd(m.currency, minor, m.digits) : "–"}</span>
                <span role="cell" className="s">{startsAt ? at(startsAt, m.zone, true) : "–"}</span>
                <span role="cell" className="s">{r.sold.toLocaleString("en-US")}</span>
                <span role="cell" className={`ai${warn ? " warn" : ""}`}>
                  {warn && <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1l1.6 4.4L14 7l-4.4 1.6L8 13l-1.6-4.4L2 7l4.4-1.6z" /></svg>}
                  <span>{r.note || "–"}</span>
                  {canEdit && <button type="button" className="x" aria-label={`Remove ${m.name}`} onClick={() => setRows(rows.filter((_, j) => j !== i))}>×</button>}
                </span>
              </div>
            );
          })}
        </div>
        {canEdit && (
          <div className="stpr-foot">
            {missing.length > 0 && (
              <label className="stpr-add"><span>Add a country</span>
                <select value="" onChange={(e) => e.target.value && setRows([...rows, { country: e.target.value, text: "", note: "", sold: 0 }])}>
                  <option value="">Choose…</option>
                  {missing.map((m) => <option key={m.country} value={m.country}>{m.name}</option>)}
                </select>
              </label>
            )}
            <label className="stpr-add"><span>Everywhere else (USD)</span><input className="stpr-in" inputMode="decimal" value={base} onChange={(e) => setBase(e.target.value)} aria-label="Base price in US dollars" /></label>
          </div>
        )}
        <p className="pt-hint">Nigeria pays your naira price through Paystack or Flutterwave. Other countries pay the US dollar price at checkout for now; checkout in each local currency is <em className="soon-tag">Soon</em></p>
      </section>
    </div>
  );
}
